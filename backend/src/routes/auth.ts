import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { ethers } from "ethers";
import * as fcl from "@onflow/fcl";
import { eq } from "drizzle-orm";
import { db } from "../config/db.js";
import { userWalletsTable, authSessionsTable } from "../schema/index.js";
import { createCustodialWallet } from "../lib/custodial-keys.js";
import { asyncHandler } from "../lib/async-handler.js";

// Configure FCL for backend verification
fcl.config({
  "flow.network": "testnet",
  "accessNode.api": "https://rest-testnet.onflow.org",
});

const router: IRouter = Router();

router.post("/auth/flow", asyncHandler(async (req, res) => {
  console.log("Auth Flow Request Body:", JSON.stringify(req.body, null, 2));
  
  const { method, signatures, userAddress, userEvmAddress } = req.body as {
    method: string;
    signatures?: Array<{ addr: string; signature: string; keyId: number }>;
    userAddress?: string;
    userEvmAddress?: string;
  };

  if (!method) {
    res.status(400).json({ error: "BAD_REQUEST", message: "method is required" });
    return;
  }

  const validMethods = ["passkey", "google", "apple", "email"];
  if (!validMethods.includes(method)) {
    res.status(400).json({ error: "BAD_REQUEST", message: `invalid method: ${method}` });
    return;
  }

  if (!userAddress) {
    res.status(400).json({ error: "BAD_REQUEST", message: "userAddress is required" });
    return;
  }

  if (!signatures || signatures.length === 0) {
    res.status(400).json({ error: "BAD_REQUEST", message: "signatures array is required and cannot be empty" });
    return;
  }

  const flowAccountId = userAddress;
  const existing = await db
    .select()
    .from(userWalletsTable)
    .where(eq(userWalletsTable.flowAddress, flowAccountId))
    .limit(1);
  const isNewUser = existing.length === 0;

  let resolvedUserEvmAddress: string;
  let custodialPrivateKeyCiphertext: string | null = null;

  if (!isNewUser) {
    resolvedUserEvmAddress = existing[0].userEvmAddress;
  } else if (userEvmAddress && ethers.isAddress(userEvmAddress)) {
    resolvedUserEvmAddress = ethers.getAddress(userEvmAddress);
  } else {
    // New user without provided EVM address -> create custodial wallet
    const custodial = createCustodialWallet();
    resolvedUserEvmAddress = custodial.address;
    custodialPrivateKeyCiphertext = custodial.privateKeyCiphertext;
  }

  // 1. Sign a message to prove ownership (Hardening requirement)
  // The frontend sends message hex encoded. FCL verifyUserSignatures expects it too.
  try {
    const msg = `flow-auth:${flowAccountId}`;
    const msgHex = Buffer.from(msg).toString("hex");

    const isVerified = await fcl.AppUtils.verifyUserSignatures(
      msgHex,
      signatures
    );

    if (!isVerified) {
      res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Flow signature verification failed",
      });
      return;
    }
  } catch (err: any) {
    console.error("FCL Verification Error:", err);
    res.status(401).json({
      error: "UNAUTHORIZED",
      message: `Failed to verify Flow signature: ${err.message}`,
    });
    return;
  }

  if (isNewUser) {
    await db.insert(userWalletsTable).values({
      flowAddress: flowAccountId,
      userEvmAddress: resolvedUserEvmAddress,
      custodialPrivateKeyCiphertext,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoNothing();
  }

  const displayName =
    method === "google"
      ? "Flow User (Google)"
      : method === "apple"
        ? "Flow User (Apple)"
        : method === "passkey"
          ? "Flow User (Passkey)"
          : "Flow User (Email)";

  const sessionToken = `flow-${randomUUID()}`;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

  await db.insert(authSessionsTable).values({
    sessionToken,
    flowAddress: flowAccountId,
    expiresAt,
    createdAt: new Date(),
  });

  res.json({
    userAddress: flowAccountId,
    displayName,
    flowAccountId,
    userEvmAddress: resolvedUserEvmAddress,
    sessionToken,
    expiresAt: expiresAt.toISOString(),
    isNewUser,
  });
}));

export default router;
