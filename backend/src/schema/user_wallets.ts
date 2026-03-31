import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userWalletsTable = pgTable("user_wallets", {
  flowAddress: text("flow_address").primaryKey(),
  userEvmAddress: text("user_evm_address").notNull().unique(),
  custodialPrivateKeyCiphertext: text("custodial_private_key_ciphertext"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserWalletSchema = createInsertSchema(userWalletsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertUserWallet = z.infer<typeof insertUserWalletSchema>;
export type UserWallet = typeof userWalletsTable.$inferSelect;

