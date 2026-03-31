import { pgTable, text, integer, numeric, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sessionStatusEnum = pgEnum("session_status", ["active", "ended", "settled"]);

export const sessionsTable = pgTable("sessions", {
  sessionId: text("session_id").primaryKey(),
  userAddress: text("user_address").notNull(),
  userEvmAddress: text("user_evm_address"),
  providerFlowAddress: text("provider_flow_address"),
  nodeId: text("node_id").notNull(),
  status: sessionStatusEnum("status").notNull().default("active"),
  encryptedStartTime: text("encrypted_start_time").notNull(),
  encryptedEndTime: text("encrypted_end_time"),
  startTxHash: text("start_tx_hash"),
  endTxHash: text("end_tx_hash"),
  startImporterAddress: text("start_importer_address"),
  endImporterAddress: text("end_importer_address"),
  startInputProofHash: text("start_input_proof_hash"),
  endInputProofHash: text("end_input_proof_hash"),
  encryptedDuration: text("encrypted_duration"),
  encryptedAmount: text("encrypted_amount"),
  settlementToken: text("settlement_token"),
  settlementAmount: numeric("settlement_amount", { precision: 36, scale: 18 }),
  settlementTxHash: text("settlement_tx_hash"),
  settlementStatus: text("settlement_status"),
  settlementFailureReason: text("settlement_failure_reason"),
  settlementAttemptCount: integer("settlement_attempt_count").notNull().default(0),
  settledAt: timestamp("settled_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSessionSchema = createInsertSchema(sessionsTable).omit({ createdAt: true, updatedAt: true });
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessionsTable.$inferSelect;
