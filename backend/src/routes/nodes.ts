import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import { ethers } from "ethers";
import { db } from "../config/db.js";
import { nodesTable, providerClaimsTable, withdrawRequestsTable } from "../schema/index.js";
import { asyncHandler } from "../lib/async-handler.js";
import { transferFlowFromTreasury } from "../lib/flow-settlement.js";
import { logger } from "../lib/logger.js";

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
    const { nodeId } = req.params as { nodeId: string };
    const { callerAddress, callerEvmAddress, idempotencyKey } = req.body as {
      callerAddress?: string;
      callerEvmAddress?: string;
      idempotencyKey?: string;
    };
    const resolvedCaller = callerEvmAddress ?? callerAddress;
    const resolvedIdempotencyKey =
      idempotencyKey ??
      (typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : undefined);

    if (!resolvedIdempotencyKey) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: "idempotencyKey is required" });
      return;
    }

    const nodeResult = await db
      .select()
      .from(nodesTable)
      .where(eq(nodesTable.nodeId, nodeId))
      .limit(1);
    
    if (!nodeResult.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Node not found" });
      return;
    }
    const node = nodeResult[0];

    // Authorization
    if (
      !resolvedCaller ||
      !ethers.isAddress(resolvedCaller) ||
      node.address.toLowerCase() !== resolvedCaller.toLowerCase()
    ) {
      res.status(403).json({ error: "FORBIDDEN", message: "Caller matches node owner" });
      return;
    }

    // 1. Check idempotency
    const existingRequest = await db
      .select()
      .from(withdrawRequestsTable)
      .where(eq(withdrawRequestsTable.idempotencyKey, resolvedIdempotencyKey))
      .limit(1);

    if (existingRequest.length > 0) {
      const prior = existingRequest[0];
      if (prior.status === "confirmed" && prior.txHash) {
        res.json({ nodeId: prior.nodeId, txHash: prior.txHash, amount: prior.amount, status: "confirmed" });
        return;
      }
      if (prior.status === "processing") {
        res.status(409).json({ error: "REQUEST_IN_PROGRESS", message: "Withdrawal is already being processed" });
        return;
      }
      // If 'failed', we allow a different idempotency key or re-attempt if safe.
    }

    // 2. Check claims
    const claims = await db
      .select()
      .from(providerClaimsTable)
      .where(eq(providerClaimsTable.nodeId, nodeId))
      .limit(1);
    if (!claims.length || Number(claims[0].claimableAmount) <= 0) {
      res.status(400).json({ error: "NO_CLAIMABLE_BALANCE", message: "No claimable balance available" });
      return;
    }
    const claimableAmount = String(claims[0].claimableAmount);

    // 3. Create 'processing' state
    await db.insert(withdrawRequestsTable).values({
      idempotencyKey: resolvedIdempotencyKey,
      nodeId,
      providerFlowAddress: ethers.getAddress(node.flowAddress!),
      amount: claimableAmount,
      status: "processing",
      createdAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoNothing(); // If already failed, we might need a better transition

    try {
      // 4. External fund transfer
      const transfer = await transferFlowFromTreasury({
        recipientAddress: ethers.getAddress(node.flowAddress!),
        amountFlow: claimableAmount,
        context: `node-withdraw:${nodeId}:${resolvedIdempotencyKey}`,
      });

      // 5. Atomic finalized commit (Critical fix)
      await db.transaction(async (tx) => {
        // Double-check balance still exists (basic protection)
        const currentClaim = await tx.select().from(providerClaimsTable).where(eq(providerClaimsTable.nodeId, nodeId)).limit(1).for("update");
        if (!currentClaim.length || Number(currentClaim[0].claimableAmount) < Number(claimableAmount)) {
          // This should ideally not happen if we used 'FOR UPDATE' or similar earlier, 
          // but if it does, we have a consistency problem that requires manual audit because funds ARE sent.
          throw new Error("CRITICAL_CONSISTENCY_ERROR: Balance changed during withdrawal");
        }

        await tx.update(providerClaimsTable)
          .set({ claimableAmount: "0", updatedAt: new Date() })
          .where(eq(providerClaimsTable.nodeId, nodeId));

        await tx.update(withdrawRequestsTable)
          .set({ txHash: transfer.txHash, status: "confirmed", updatedAt: new Date() })
          .where(eq(withdrawRequestsTable.idempotencyKey, resolvedIdempotencyKey));

        await tx.update(nodesTable)
          .set({ encryptedEarnings: "0x0" })
          .where(eq(nodesTable.nodeId, nodeId));
      });

      res.json({ nodeId, txHash: transfer.txHash, amount: claimableAmount, status: "confirmed" });
    } catch (err: any) {
      // If we already sent funds but the DB finalization failed, we MUST NOT mark it as 'failed' 
      // if it might lead the user to try again with a different ID.
      // Better to leave it as 'processing' or a new 'manual_reconciliation_required' state.
      
      logger.error({ err, nodeId, resolvedIdempotencyKey }, "Withdrawal finalization failed AFTER fund transfer");
      
      res.status(500).json({
        error: "WITHDRAWAL_FINALIZATION_FAILED",
        message: "Funds were sent but database update failed. Contact support for manual balance reset.",
        details: err.message
      });
    }
  })
);

export default router;
