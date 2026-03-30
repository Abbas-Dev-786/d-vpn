import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { createHash } from "crypto";
import { eq, desc } from "drizzle-orm";
import { ethers } from "ethers";
import { db } from "../config/db";
import { sessionsTable, nodesTable } from "../schema";
import { asyncHandler } from "../lib/async-handler";
import { startSessionOnChain, endSessionOnChain, type EncryptedInputPayload } from "../lib/zama-relayer";

const router: IRouter = Router();
const HASH_PREFIX = "0x";

const hashProof = (proof: string): string =>
  `${HASH_PREFIX}${createHash("sha256").update(proof).digest("hex")}`;

const normalizeEncryptedPayload = (
  value: string | EncryptedInputPayload,
): EncryptedInputPayload => {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  const payload = parsed as Partial<EncryptedInputPayload>;

  if (!payload.handle || !ethers.isHexString(payload.handle, 32)) {
    throw new Error("Invalid encrypted handle");
  }
  if (!payload.inputProof || !ethers.isHexString(payload.inputProof)) {
    throw new Error("Invalid encrypted input proof");
  }
  if (!payload.importerAddress || !ethers.isAddress(payload.importerAddress)) {
    throw new Error("Invalid importer address");
  }

  return {
    handle: payload.handle,
    inputProof: payload.inputProof,
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
      if (!ethers.isAddress(node[0].address)) {
        res.status(500).json({
          error: "INVALID_NODE_CONFIG",
          message: "Selected node does not have a valid provider EVM address",
        });
        return;
      }

      const sessionId = `sess_${randomUUID()}`;
      const now = new Date();

      // Submit encrypted payload through the trusted relayer.
      const txHash = await startSessionOnChain(
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
          nodeId,
          status: "active",
          encryptedStartTime: normalizedPayload.handle,
          startTxHash: txHash,
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

      const now = new Date();
      const userEvmAddress = existing[0].userEvmAddress;
      if (!userEvmAddress || !ethers.isAddress(userEvmAddress)) {
        res.status(500).json({
          error: "INVALID_SESSION_CONFIG",
          message: "Session is missing userEvmAddress",
        });
        return;
      }

      // Submit encrypted payload through trusted relayer for homomorphic settlement.
      const txHash = await endSessionOnChain(ethers.getAddress(userEvmAddress), normalizedPayload);

      const [session] = await db
        .update(sessionsTable)
        .set({
          status: "ended",
          encryptedEndTime: normalizedPayload.handle,
          endTxHash: txHash,
          endImporterAddress: normalizedPayload.importerAddress,
          endInputProofHash: hashProof(normalizedPayload.inputProof),
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
