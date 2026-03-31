import { pgTable, text, numeric, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const paymentFrequencyEnum = pgEnum("payment_frequency", ["monthly", "weekly"]);

export const paymentSchedulesTable = pgTable("payment_schedules", {
  scheduleId: text("schedule_id").primaryKey(),
  userAddress: text("user_address").notNull(),
  custodialWalletAddress: text("custodial_wallet_address"),
  budgetAmount: numeric("budget_amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  frequency: paymentFrequencyEnum("frequency").notNull().default("monthly"),
  flowAutopilotId: text("flow_autopilot_id"),
  scheduleTxHash: text("schedule_tx_hash"),
  cadence: text("cadence"),
  lastRunAt: timestamp("last_run_at"),
  lastRunTxHash: text("last_run_tx_hash"),
  lastRunStatus: text("last_run_status"),
  failureReason: text("failure_reason"),
  nextDueAt: timestamp("next_due_at").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPaymentScheduleSchema = createInsertSchema(paymentSchedulesTable).omit({ createdAt: true });
export type InsertPaymentSchedule = z.infer<typeof insertPaymentScheduleSchema>;
export type PaymentSchedule = typeof paymentSchedulesTable.$inferSelect;
