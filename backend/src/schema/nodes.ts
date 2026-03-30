import { pgTable, text, integer, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const nodesTable = pgTable("nodes", {
  nodeId: text("node_id").primaryKey(),
  address: text("address").notNull(),
  name: text("name").notNull(),
  location: text("location").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  encryptedEarnings: text("encrypted_earnings").notNull().default("0x0"),
  sessionCount: integer("session_count").notNull().default(0),
  uptimePercent: numeric("uptime_percent", { precision: 5, scale: 2 }).notNull().default("99.9"),
  registeredAt: timestamp("registered_at").notNull().defaultNow(),
});

export const insertNodeSchema = createInsertSchema(nodesTable).omit({ registeredAt: true });
export type InsertNode = z.infer<typeof insertNodeSchema>;
export type Node = typeof nodesTable.$inferSelect;
