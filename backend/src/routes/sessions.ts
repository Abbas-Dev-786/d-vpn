import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { createHash } from "crypto";
import { eq, desc, sql } from "drizzle-orm";
import { ethers } from "ethers";
import { db } from "../config/db";
import { sessionsTable, nodesTable, providerClaimsTable, userWalletsTable } from "../schema";
import { asyncHandler } from "../lib/async-handler";
import { settleFlowForSession } from "../lib/flow-settlement";
import { startSessionOnChain, endSessionOnChain } from "../lib/zama-relayer";

const router: IRouter = Router();
const HASH_PREFIX = "0x";

type EncryptedInputPayload = {
  handle: string;
  inputProof: string;
  importerAddress: string;
  source?: "relayer-sdk";
};

const hashProof = (proof: string): string =>
  `${HASH_PREFIX}${createHash("sha256").update(proof).digest("hex")}`;

const bytesLikeToHex = (
  value: unknown,
  fieldName: string,
  expectedBytesLength?: number,
): string => {
  if (typeof value === "string") {
    if (!ethers.isHexString(value, expectedBytesLength)) {
      throw new Error(`Invalid ${fieldName}`);
    }
    return value;
  }

  if (value instanceof Uint8Array || Array.isArray(value)) {
    const hex = ethers.hexlify(value as Uint8Array | number[]);
    if (!ethers.isHexString(hex, expectedBytesLength)) {
      throw new Error(`Invalid ${fieldName}`);
    }
    return hex;
  }

  if (value && typeof value === "object") {
    const indexedEntries = Object.entries(value as Record<string, unknown>)
      .filter(([k]) => /^\d+$/.test(k))
      .sort((a, b) => Number(a[0]) - Number(b[0]));

    if (indexedEntries.length > 0) {
      const bytes = Uint8Array.from(indexedEntries.map(([, v]) => Number(v)));
      const hex = ethers.hexlify(bytes);
      if (!ethers.isHexString(hex, expectedBytesLength)) {
        throw new Error(`Invalid ${fieldName}`);
      }
      return hex;
    }
  }

  throw new Error(`Invalid ${fieldName}`);
};

const normalizeEncryptedPayload = (
  value: string | EncryptedInputPayload,
): EncryptedInputPayload => {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  const payload = parsed as Partial<EncryptedInputPayload>;

  const handle = bytesLikeToHex(payload.handle, "encrypted handle", 32);
  const inputProof = bytesLikeToHex(payload.inputProof, "encrypted input proof");
  if (!payload.importerAddress || !ethers.isAddress(payload.importerAddress)) {
    throw new Error("Invalid importer address");
  }

  return {
    handle,
    inputProof,
    importerAddress: payload.importerAddress,
    source: "relayer-sdk",
  };
};

router.post(
  "/sessions/start",
  asyncHandler(async (req, res) => {
    const { flowUserAddress, userAddress, userEvmAddress, nodeId, encryptedStartTime } = req.body as {
      flowUserAddress?: string;
      userAddress?: string;
      userEvmAddress?: string;
      nodeId: string;
      encryptedStartTime: string | EncryptedInputPayload;
    };
    const normalizedFlowAddress = flowUserAddress ?? userAddress;

    if (!normalizedFlowAddress || !nodeId || !encryptedStartTime || !userEvmAddress) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "flowUserAddress (or userAddress), userEvmAddress, nodeId, and encryptedStartTime are required",
      });
      return;
    }
    if (!ethers.isAddress(userEvmAddress)) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "userEvmAddress must be a valid EVM address",
      });
      return;
    }

    try {
      const normalizedPayload = normalizeEncryptedPayload(encryptedStartTime);
      const [mappedWallet] = await db
        .select()
        .from(userWalletsTable)
        .where(eq(userWalletsTable.flowAddress, normalizedFlowAddress))
        .limit(1);
      if (!mappedWallet) {
        res.status(404).json({
          error: "NOT_FOUND",
          message: "No wallet mapping found for flowUserAddress",
        });
        return;
      }
      if (mappedWallet.userEvmAddress.toLowerCase() !== userEvmAddress.toLowerCase()) {
        res.status(403).json({
          error: "FORBIDDEN",
          message: "Provided userEvmAddress does not match mapped identity",
        });
        return;
      }

      // Check if node exists and is active
      const node = await db
        .select()
        .from(nodesTable)
        .where(eq(nodesTable.nodeId, nodeId))
        .limit(1);

      if (!node.length || !node[0].isActive) {
        res
          .status(404)
          .json({ error: "NOT_FOUND", message: "Active node not found" });
        return;
      }

      if (!node[0].address || !ethers.isAddress(node[0].address)) {
        res.status(400).json({
          error: "INVALID_NODE_CONFIG",
          message: "Selected node does not have a valid provider EVM address",
        });
        return;
      }

      let providerFlowAddress: string | null = null;
      if (node[0].flowAddress && ethers.isAddress(node[0].flowAddress)) {
        providerFlowAddress = ethers.getAddress(node[0].flowAddress);
      } else if (node[0].address && ethers.isAddress(node[0].address)) {
        providerFlowAddress = ethers.getAddress(node[0].address);
        await db
          .update(nodesTable)
          .set({ flowAddress: providerFlowAddress })
          .where(eq(nodesTable.nodeId, node[0].nodeId));
      }

      if (!providerFlowAddress) {
        res.status(400).json({
          error: "INVALID_NODE_CONFIG",
          message: "Selected node does not have a valid provider Flow address",
        });
        return;
      }

      const sessionId = `sess_${randomUUID()}`;
      const now = new Date();
      const startTxHash = await startSessionOnChain(
        ethers.getAddress(userEvmAddress),
        ethers.getAddress(node[0].address),
        normalizedPayload,
      );

      const [session] = await db
        .insert(sessionsTable)
        .values({
          sessionId,
          userAddress: normalizedFlowAddress,
          userEvmAddress: ethers.getAddress(userEvmAddress),
          providerFlowAddress,
          nodeId,
          status: "active",
          encryptedStartTime: normalizedPayload.handle,
          startTxHash,
          startImporterAddress: normalizedPayload.importerAddress,
          startInputProofHash: hashProof(normalizedPayload.inputProof),
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      // Update node session count
      await db
        .update(nodesTable)
        .set({ sessionCount: (node[0].sessionCount ?? 0) + 1 })
        .where(eq(nodesTable.nodeId, nodeId));

      res.status(201).json(session);
    } catch (err: any) {
      throw Object.assign(new Error("Failed to start session"), {
        statusCode: 500,
        code: "DATABASE_ERROR",
        originalError: err,
      });
    }
  })
);

router.post(
  "/sessions/end",
  asyncHandler(async (req, res) => {
    const { sessionId, encryptedEndTime } = req.body as {
      sessionId: string;
      encryptedEndTime: string | EncryptedInputPayload;
    };

    if (!sessionId || !encryptedEndTime) {
      res.status(400).json({ 
        error: "VALIDATION_ERROR", 
        message: "sessionId and encryptedEndTime are required" 
      });
      return;
    }

    try {
      const normalizedPayload = normalizeEncryptedPayload(encryptedEndTime);

      const existing = await db
        .select()
        .from(sessionsTable)
        .where(eq(sessionsTable.sessionId, sessionId))
        .limit(1);

      if (!existing.length) {
        res
          .status(404)
          .json({ error: "NOT_FOUND", message: "Session not found" });
        return;
      }

      if (existing[0].status === "ended") {
        res
          .status(400)
          .json({ error: "BAD_REQUEST", message: "Session already ended" });
        return;
      }
      if (existing[0].status === "settled") {
        res
          .status(400)
          .json({ error: "BAD_REQUEST", message: "Session already settled" });
        return;
      }

      const now = new Date();
      const durationSeconds = Math.max(
        1,
        Math.ceil((now.getTime() - existing[0].createdAt.getTime()) / 1000),
      );
      if (!existing[0].userEvmAddress || !ethers.isAddress(existing[0].userEvmAddress)) {
        res.status(500).json({
          error: "INVALID_SESSION_CONFIG",
          message: "Session is missing a valid userEvmAddress",
        });
        return;
      }

      let providerFlowAddress = existing[0].providerFlowAddress ?? null;
      if (!providerFlowAddress || !ethers.isAddress(providerFlowAddress)) {
        const node = await db
          .select()
          .from(nodesTable)
          .where(eq(nodesTable.nodeId, existing[0].nodeId))
          .limit(1);
        if (node[0]?.flowAddress && ethers.isAddress(node[0].flowAddress)) {
          providerFlowAddress = ethers.getAddress(node[0].flowAddress);
        } else if (node[0]?.address && ethers.isAddress(node[0].address)) {
          providerFlowAddress = ethers.getAddress(node[0].address);
          await db
            .update(nodesTable)
            .set({ flowAddress: providerFlowAddress })
            .where(eq(nodesTable.nodeId, existing[0].nodeId));
        }
      }

      if (!providerFlowAddress || !ethers.isAddress(providerFlowAddress)) {
        res.status(500).json({
          error: "INVALID_SESSION_CONFIG",
          message: "Session is missing a valid provider Flow address",
        });
        return;
      }

      const endTxHash = await endSessionOnChain(
        ethers.getAddress(existing[0].userEvmAddress),
        normalizedPayload,
      );
      const settlement = await settleFlowForSession({
        sessionId,
        providerFlowAddress: ethers.getAddress(providerFlowAddress),
        durationSeconds,
      });
      const nextStatus = settlement.settlementStatus === "submitted" ? "settled" : "ended";

      if (settlement.settlementStatus !== "submitted") {
        await db
          .insert(providerClaimsTable)
          .values({
            nodeId: existing[0].nodeId,
            providerFlowAddress: ethers.getAddress(providerFlowAddress),
            claimableAmount: settlement.settlementAmountFlow,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: providerClaimsTable.nodeId,
            set: {
              providerFlowAddress: ethers.getAddress(providerFlowAddress),
              claimableAmount: sql`${providerClaimsTable.claimableAmount} + ${settlement.settlementAmountFlow}`,
              updatedAt: now,
            },
          });
      }

      const [session] = await db
        .update(sessionsTable)
        .set({
          status: nextStatus,
          providerFlowAddress: ethers.getAddress(providerFlowAddress),
          encryptedEndTime: normalizedPayload.handle,
          endTxHash,
          endImporterAddress: normalizedPayload.importerAddress,
          endInputProofHash: hashProof(normalizedPayload.inputProof),
          encryptedDuration: `offchain:${durationSeconds}s`,
          encryptedAmount: `offchain:${settlement.settlementAmountFlow}`,
          settlementToken: settlement.settlementToken,
          settlementAmount: settlement.settlementAmountFlow,
          settlementTxHash: settlement.settlementTxHash,
          settlementStatus: settlement.settlementStatus,
          settlementFailureReason: settlement.settlementFailureReason,
          settlementAttemptCount: settlement.settlementAttemptCount,
          settledAt: settlement.settledAt,
          updatedAt: now,
        })
        .where(eq(sessionsTable.sessionId, sessionId))
        .returning();

      res.json(session);
    } catch (err: any) {
      throw Object.assign(new Error("Failed to end session"), {
        statusCode: 500,
        code: "DATABASE_ERROR",
        originalError: err,
      });
    }
  })
);

router.get(
  "/sessions/history",
  asyncHandler(async (req, res) => {
    const { userAddress } = req.query as { userAddress?: string };

    if (!userAddress) {
      res
        .status(400)
        .json({ error: "VALIDATION_ERROR", message: "userAddress is required" });
      return;
    }

    const sessions = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.userAddress, userAddress))
      .orderBy(desc(sessionsTable.createdAt));

    res.json({
      sessions,
      total: sessions.length,
    });
  })
);

export default router;
