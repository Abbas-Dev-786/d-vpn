import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const authSessionsTable = pgTable("auth_sessions", {
  sessionToken: text("session_token").primaryKey(),
  flowAddress: text("flow_address").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAuthSessionSchema = createInsertSchema(authSessionsTable);
export type InsertAuthSession = z.infer<typeof insertAuthSessionSchema>;
export type AuthSession = typeof authSessionsTable.$inferSelect;
