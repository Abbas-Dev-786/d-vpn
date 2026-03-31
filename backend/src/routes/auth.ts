import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { ethers } from "ethers";
import { eq } from "drizzle-orm";
import { db } from "../config/db.js";
import { userWalletsTable, authSessionsTable } from "../schema/index.js";
import { createCustodialWallet } from "../lib/custodial-keys.js";
import { asyncHandler } from "../lib/async-handler.js";

const router: IRouter = Router();

router.post("/auth/flow", asyncHandler(async (req, res) => {
  const { method, credential, userAddress, userEvmAddress } = req.body as {
    method: string;
    credential?: string;
    userAddress?: string;
    userEvmAddress?: string;
  };

  if (!method) {
    res.status(400).json({ error: "BAD_REQUEST", message: "method is required" });
    return;
  }

  const validMethods = ["passkey", "google", "apple", "email"];
  if (!validMethods.includes(method)) {
    res.status(400).json({ error: "BAD_REQUEST", message: "invalid method" });
    return;
  }

  if (!userAddress) {
    res.status(400).json({ error: "BAD_REQUEST", message: "userAddress is required" });
    return;
  }

  if (!credential) {
    res.status(400).json({ error: "BAD_REQUEST", message: "credential (signature) is required" });
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

  // Mandatory credential verification for ALL users
  try {
    const recovered = ethers.verifyMessage(`flow-auth:${flowAccountId}`, credential);
    if (recovered.toLowerCase() !== resolvedUserEvmAddress.toLowerCase()) {
      res.status(401).json({
        error: "UNAUTHORIZED",
        message: "credential signature does not match target EVM address",
      });
      return;
    }
  } catch (err) {
    res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Failed to verify credential signature",
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
