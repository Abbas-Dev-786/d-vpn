import { pgTable, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const withdrawRequestsTable = pgTable("withdraw_requests", {
  idempotencyKey: text("idempotency_key").primaryKey(),
  nodeId: text("node_id").notNull(),
  providerFlowAddress: text("provider_flow_address").notNull(),
  amount: numeric("amount", { precision: 36, scale: 18 }).notNull(),
  txHash: text("tx_hash"),
  status: text("status").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertWithdrawRequestSchema = createInsertSchema(withdrawRequestsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertWithdrawRequest = z.infer<typeof insertWithdrawRequestSchema>;
export type WithdrawRequest = typeof withdrawRequestsTable.$inferSelect;
