import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { eq, desc } from "drizzle-orm";
import { db } from "../config/db";
import { sessionsTable, nodesTable } from "../schema";
import { asyncHandler } from "../lib/async-handler";
import { startSessionOnChain, endSessionOnChain } from "../lib/zama-relayer";

const router: IRouter = Router();

router.post(
  "/sessions/start",
  asyncHandler(async (req, res) => {
    const { userAddress, nodeId, encryptedStartTime } = req.body as {
      userAddress: string;
      nodeId: string;
      encryptedStartTime: string;
    };

    if (!userAddress || !nodeId || !encryptedStartTime) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "userAddress, nodeId, and encryptedStartTime are required",
      });
      return;
    }

    try {
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

      const sessionId = `sess_${randomUUID()}`;
      const now = new Date();

      // Submit the Zama FHE payload to the smart contract using the trusted relayer
      const txHash = await startSessionOnChain(userAddress, nodeId, encryptedStartTime);

      const [session] = await db
        .insert(sessionsTable)
        .values({
          sessionId,
          userAddress,
          nodeId,
          status: "active",
          encryptedStartTime: txHash, // store the on-chain reference instead of the payload
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
      encryptedEndTime: string;
    };

    if (!sessionId || !encryptedEndTime) {
      res.status(400).json({ 
        error: "VALIDATION_ERROR", 
        message: "sessionId and encryptedEndTime are required" 
      });
      return;
    }

    try {
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
      
      // Submit the Zama FHE payload to compute duration and payment homomorphically
      // using the trusted relayer on behalf of the user
      const txHash = await endSessionOnChain(existing[0].userAddress, encryptedEndTime);

      const [session] = await db
        .update(sessionsTable)
        .set({
          status: "ended",
          encryptedEndTime: txHash,
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
