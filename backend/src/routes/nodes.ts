import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { ethers } from "ethers";
import { db } from "../config/db";
import { nodesTable, providerClaimsTable, withdrawRequestsTable } from "../schema";
import { asyncHandler } from "../lib/async-handler";
import { transferFlowFromTreasury } from "../lib/flow-settlement";

const router: IRouter = Router();

router.get(
  "/nodes",
  asyncHandler(async (_req, res) => {
    const nodes = await db
      .select()
      .from(nodesTable)
      .orderBy(nodesTable.registeredAt);
    const total = nodes.length;

    res.json({
      nodes: nodes.map((n) => ({
        ...n,
        evmAddress: n.address,
        uptimePercent: parseFloat(String(n.uptimePercent)),
        registeredAt: n.registeredAt.toISOString(),
      })),
      total,
    });
  })
);

router.post(
  "/nodes",
  asyncHandler(async (req, res) => {
    const { address, evmAddress, flowAddress, name, location } = req.body as {
      address?: string;
      evmAddress?: string;
      flowAddress?: string;
      name: string;
      location: string;
    };
    const resolvedEvmAddress = evmAddress ?? address;

    if (!resolvedEvmAddress || !flowAddress || !name || !location) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "evmAddress (or address), flowAddress, name, and location are required",
      });
      return;
    }
    if (!ethers.isAddress(resolvedEvmAddress)) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "evmAddress must be a valid EVM address",
      });
      return;
    }
    if (!ethers.isAddress(flowAddress)) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "flowAddress must be a valid Flow EVM address",
      });
      return;
    }

    const nodeId = `node_${randomUUID()}`;

    try {
      const [node] = await db
        .insert(nodesTable)
        .values({
          nodeId,
          address: ethers.getAddress(resolvedEvmAddress),
          flowAddress: ethers.getAddress(flowAddress),
          name,
          location,
          isActive: true,
          encryptedEarnings: "0x0",
          sessionCount: 0,
          uptimePercent: "99.9",
          registeredAt: new Date(),
        })
        .returning();
      await db
        .insert(providerClaimsTable)
        .values({
          nodeId,
          providerFlowAddress: ethers.getAddress(flowAddress),
          claimableAmount: "0",
          updatedAt: new Date(),
        })
        .onConflictDoNothing();

      if (!node) {
        throw new Error("Failed to register node");
      }

      res.status(201).json({
        ...node,
        evmAddress: node.address,
        uptimePercent: parseFloat(String(node.uptimePercent)),
        registeredAt: node.registeredAt.toISOString(),
      });
    } catch (err: any) {
      throw Object.assign(new Error("Failed to register node"), {
        statusCode: 500,
        code: "DATABASE_ERROR",
        originalError: err,
      });
    }
  })
);

router.post(
  "/nodes/:nodeId/withdraw",
  asyncHandler(async (req, res) => {
    const { nodeId } = req.params;
    const { callerAddress, callerEvmAddress, idempotencyKey } = req.body as {
      callerAddress?: string;
      callerEvmAddress?: string;
      idempotencyKey?: string;
    };
    const resolvedCaller = callerEvmAddress ?? callerAddress;
    const resolvedIdempotencyKey =
      idempotencyKey ??
      (typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : undefined);

    const existing = await db
      .select()
      .from(nodesTable)
      .where(eq(nodesTable.nodeId, nodeId))
      .limit(1);
    
    if (!existing.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Node not found" });
      return;
    }

    const node = existing[0];

    // Authorization: only the node's registered owner address may withdraw
    if (
      !resolvedCaller ||
      !ethers.isAddress(resolvedCaller) ||
      node.address.toLowerCase() !== resolvedCaller.toLowerCase()
    ) {
      res.status(403).json({
        error: "FORBIDDEN",
        message: "Caller EVM address does not match node owner",
      });
      return;
    }
    if (!resolvedIdempotencyKey) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "idempotencyKey is required",
      });
      return;
    }
    if (!node.flowAddress || !ethers.isAddress(node.flowAddress)) {
      res.status(400).json({
        error: "INVALID_NODE_CONFIG",
        message: "Node does not have a valid provider Flow address",
      });
      return;
    }

    const existingRequest = await db
      .select()
      .from(withdrawRequestsTable)
      .where(eq(withdrawRequestsTable.idempotencyKey, resolvedIdempotencyKey))
      .limit(1);
    if (existingRequest.length > 0) {
      const prior = existingRequest[0];
      if (prior.status === "confirmed" && prior.txHash) {
        res.json({
          nodeId: prior.nodeId,
          txHash: prior.txHash,
          amount: String(prior.amount),
          status: "confirmed",
        });
        return;
      }
      res.status(409).json({
        error: "REQUEST_IN_PROGRESS",
        message: "A withdrawal with this idempotency key is already being processed",
      });
      return;
    }

    const claims = await db
      .select()
      .from(providerClaimsTable)
      .where(eq(providerClaimsTable.nodeId, nodeId))
      .limit(1);
    if (!claims.length || Number(claims[0].claimableAmount) <= 0) {
      res.status(400).json({
        error: "NO_CLAIMABLE_BALANCE",
        message: "No claimable balance is available for this node",
      });
      return;
    }
    const claimableAmount = String(claims[0].claimableAmount);

    try {
      await db.insert(withdrawRequestsTable).values({
        idempotencyKey: resolvedIdempotencyKey,
        nodeId,
        providerFlowAddress: ethers.getAddress(node.flowAddress),
        amount: claimableAmount,
        txHash: null,
        status: "processing",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const transfer = await transferFlowFromTreasury({
        recipientAddress: ethers.getAddress(node.flowAddress),
        amountFlow: claimableAmount,
        context: `node-withdraw:${nodeId}`,
      });

      await db.transaction(async (tx) => {
        await tx
          .update(providerClaimsTable)
          .set({
            claimableAmount: "0",
            updatedAt: new Date(),
          })
          .where(eq(providerClaimsTable.nodeId, nodeId));

        await tx
          .update(withdrawRequestsTable)
          .set({
            txHash: transfer.txHash,
            status: "confirmed",
            updatedAt: new Date(),
          })
          .where(eq(withdrawRequestsTable.idempotencyKey, resolvedIdempotencyKey));

        await tx
          .update(nodesTable)
          .set({ encryptedEarnings: "0x0" })
          .where(eq(nodesTable.nodeId, nodeId));
      });

      res.json({
        nodeId,
        txHash: transfer.txHash,
        amount: claimableAmount,
        status: "confirmed",
      });
    } catch (err: any) {
      await db
        .update(withdrawRequestsTable)
        .set({
          status: "failed",
          updatedAt: new Date(),
        })
        .where(eq(withdrawRequestsTable.idempotencyKey, resolvedIdempotencyKey));

      throw Object.assign(new Error("Failed to process withdrawal"), {
        statusCode: 500,
        code: "DATABASE_ERROR",
        originalError: err,
      });
    }
  })
);

export default router;
