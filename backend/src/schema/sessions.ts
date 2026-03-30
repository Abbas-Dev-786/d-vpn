import { pgTable, text, integer, numeric, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sessionStatusEnum = pgEnum("session_status", ["active", "ended", "settled"]);

export const sessionsTable = pgTable("sessions", {
  sessionId: text("session_id").primaryKey(),
  userAddress: text("user_address").notNull(),
  nodeId: text("node_id").notNull(),
  status: sessionStatusEnum("status").notNull().default("active"),
  encryptedStartTime: text("encrypted_start_time").notNull(),
  encryptedEndTime: text("encrypted_end_time"),
  encryptedDuration: text("encrypted_duration"),
  encryptedAmount: text("encrypted_amount"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSessionSchema = createInsertSchema(sessionsTable).omit({ createdAt: true, updatedAt: true });
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessionsTable.$inferSelect;
