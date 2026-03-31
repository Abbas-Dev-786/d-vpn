import { pgTable, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const providerClaimsTable = pgTable("provider_claims", {
  nodeId: text("node_id").primaryKey(),
  providerFlowAddress: text("provider_flow_address").notNull(),
  claimableAmount: numeric("claimable_amount", { precision: 36, scale: 18 }).notNull().default("0"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertProviderClaimSchema = createInsertSchema(providerClaimsTable).omit({
  updatedAt: true,
});

export type InsertProviderClaim = z.infer<typeof insertProviderClaimSchema>;
export type ProviderClaim = typeof providerClaimsTable.$inferSelect;

