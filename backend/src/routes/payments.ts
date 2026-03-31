import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../config/db";
import { paymentSchedulesTable, userWalletsTable } from "../schema";
import { asyncHandler } from "../lib/async-handler";
import { createFlowSchedule, getFlowSchedule } from "../lib/flow-scheduler";
import { getRuntimeConfig } from "../config/runtime";

const router: IRouter = Router();
const runtime = getRuntimeConfig();

router.post(
  "/payments/schedule",
  asyncHandler(async (req, res) => {
    const {
      userAddress,
      budgetAmount,
      currency = "USD",
      frequency = "monthly",
    } = req.body as {
      userAddress: string;
      budgetAmount: number;
      currency?: string;
      frequency?: string;
    };

    if (!userAddress || !budgetAmount || budgetAmount <= 0) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "userAddress and positive budgetAmount are required",
      });
      return;
    }

    const [wallet] = await db
      .select()
      .from(userWalletsTable)
      .where(eq(userWalletsTable.flowAddress, userAddress))
      .limit(1);
    if (!wallet) {
      res.status(404).json({
        error: "NOT_FOUND",
        message: "No wallet mapping exists for this Flow user",
      });
      return;
    }

    const scheduleId = `sched_${randomUUID()}`;
    const now = new Date();
    const createdSchedule = await createFlowSchedule({
      scheduleId,
      flowUserAddress: userAddress,
      custodialWalletAddress: wallet.userEvmAddress,
      treasuryAddress: runtime.flowTreasuryAddress,
      budgetAmount: String(budgetAmount),
      frequency: frequency === "weekly" ? "weekly" : "monthly",
      metadata: {
        currency,
      },
    });
    const nextDueAt = new Date(createdSchedule.nextRunAt);

    try {
      const [schedule] = await db
        .insert(paymentSchedulesTable)
        .values({
          scheduleId,
          userAddress,
          custodialWalletAddress: wallet.userEvmAddress,
          budgetAmount: String(budgetAmount),
          currency,
          frequency: frequency as "monthly" | "weekly",
          flowAutopilotId: createdSchedule.jobId,
          scheduleTxHash: createdSchedule.scheduleTxHash,
          cadence: createdSchedule.cadence,
          nextDueAt,
          isActive: true,
          lastRunAt: null,
          lastRunTxHash: null,
          lastRunStatus: null,
          failureReason: null,
          createdAt: now,
        })
        .returning();

      if (!schedule) {
        throw new Error("Failed to create payment schedule");
      }

      res.status(201).json({
        ...schedule,
        budgetAmount: parseFloat(String(schedule.budgetAmount)),
        nextDueAt: schedule.nextDueAt.toISOString(),
        lastRunAt: schedule.lastRunAt ? schedule.lastRunAt.toISOString() : null,
        createdAt: schedule.createdAt.toISOString(),
      });
    } catch (err: any) {
      throw Object.assign(new Error("Failed to schedule payment"), {
        statusCode: 500,
        code: "DATABASE_ERROR",
        originalError: err,
      });
    }
  })
);

router.get(
  "/payments/schedules",
  asyncHandler(async (req, res) => {
    const { userAddress } = req.query as { userAddress?: string };

    if (!userAddress) {
      res
        .status(400)
        .json({ error: "VALIDATION_ERROR", message: "userAddress is required" });
      return;
    }

    const schedules = await db
      .select()
      .from(paymentSchedulesTable)
      .where(eq(paymentSchedulesTable.userAddress, userAddress))
      .orderBy(paymentSchedulesTable.createdAt);

    const refreshed = await Promise.all(
      schedules.map(async (schedule) => {
        if (!schedule.flowAutopilotId) return schedule;
        try {
          const status = await getFlowSchedule(schedule.flowAutopilotId);
          const patch = {
            nextDueAt: new Date(status.nextRunAt),
            isActive: status.status === "active" || status.status === "pending",
            lastRunAt: status.lastRunAt ? new Date(status.lastRunAt) : schedule.lastRunAt,
            lastRunStatus: status.lastRunStatus ?? schedule.lastRunStatus,
            lastRunTxHash: status.lastRunTxHash ?? schedule.lastRunTxHash,
            failureReason: status.failureReason ?? null,
          };
          const [updated] = await db
            .update(paymentSchedulesTable)
            .set(patch)
            .where(eq(paymentSchedulesTable.scheduleId, schedule.scheduleId))
            .returning();
          return updated ?? schedule;
        } catch {
          return schedule;
        }
      }),
    );

    res.json({
      schedules: refreshed.map((s) => ({
        ...s,
        budgetAmount: parseFloat(String(s.budgetAmount)),
        nextDueAt: s.nextDueAt.toISOString(),
        lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
        createdAt: s.createdAt.toISOString(),
      })),
      total: refreshed.length,
    });
  })
);

export default router;
