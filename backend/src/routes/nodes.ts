import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { ethers } from "ethers";
import { db } from "../config/db";
import { nodesTable } from "../schema";
import { asyncHandler } from "../lib/async-handler";

const router: IRouter = Router();

function simulateFheEncryptEarnings(): string {
  return `0x${"fhe_earnings_" + randomUUID().replace(/-/g, "").slice(0, 51)}`;
}

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
    const encryptedEarnings = simulateFheEncryptEarnings();

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
          encryptedEarnings,
          sessionCount: 0,
          uptimePercent: "99.9",
          registeredAt: new Date(),
        })
        .returning();

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
    const { callerAddress, callerEvmAddress } = req.body as { callerAddress?: string; callerEvmAddress?: string };
    const resolvedCaller = callerEvmAddress ?? callerAddress;

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

    const txHash =
      `0x${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}`.slice(
        0,
        66,
      );
    const amount = (Math.random() * 50 + 1).toFixed(4);

    const newEncryptedEarnings = simulateFheEncryptEarnings();
    
    try {
      await db
        .update(nodesTable)
        .set({ encryptedEarnings: newEncryptedEarnings })
        .where(eq(nodesTable.nodeId, nodeId));

      res.json({
        nodeId,
        txHash,
        amount,
        status: "pending",
      });
    } catch (err: any) {
      throw Object.assign(new Error("Failed to process withdrawal"), {
        statusCode: 500,
        code: "DATABASE_ERROR",
        originalError: err,
      });
    }
  })
);

export default router;
