import { pgTable, text, integer, numeric, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sessionStatusEnum = pgEnum("session_status", ["active", "ended", "settled"]);

export const sessionsTable = pgTable("sessions", {
  sessionId: text("session_id").primaryKey(),
  userAddress: text("user_address").notNull(),
  userEvmAddress: text("user_evm_address"),
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSessionSchema = createInsertSchema(sessionsTable).omit({ createdAt: true, updatedAt: true });
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessionsTable.$inferSelect;
