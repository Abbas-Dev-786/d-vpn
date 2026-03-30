import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../config/db";
import { paymentSchedulesTable } from "../schema";
import { asyncHandler } from "../lib/async-handler";

const router: IRouter = Router();

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

    if (!userAddress || !budgetAmount) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "userAddress and budgetAmount are required",
      });
      return;
    }

    const scheduleId = `sched_${randomUUID()}`;
    const flowAutopilotId = `autopilot_${randomUUID()}`;
    const now = new Date();
    const nextDueAt = new Date(now);

    if (frequency === "weekly") {
      nextDueAt.setDate(nextDueAt.getDate() + 7);
    } else {
      nextDueAt.setMonth(nextDueAt.getMonth() + 1);
    }

    try {
      const [schedule] = await db
        .insert(paymentSchedulesTable)
        .values({
          scheduleId,
          userAddress,
          budgetAmount: String(budgetAmount),
          currency,
          frequency: frequency as "monthly" | "weekly",
          flowAutopilotId,
          nextDueAt,
          isActive: true,
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

    res.json({
      schedules: schedules.map((s) => ({
        ...s,
        budgetAmount: parseFloat(String(s.budgetAmount)),
        nextDueAt: s.nextDueAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
      })),
      total: schedules.length,
    });
  })
);

export default router;
