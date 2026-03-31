import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { ethers } from "ethers";
import { eq } from "drizzle-orm";
import { db } from "../config/db";
import { userWalletsTable } from "../schema";
import { createCustodialWallet } from "../lib/custodial-keys";

const router: IRouter = Router();

router.post("/auth/flow", async (req, res) => {
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

  const flowAccountId = userAddress;
  const existing = await db
    .select()
    .from(userWalletsTable)
    .where(eq(userWalletsTable.flowAddress, flowAccountId))
    .limit(1);
  const isNewUser = existing.length === 0;

  let resolvedUserEvmAddress: string;
  let custodialPrivateKeyCiphertext: string | null = null;

  if (existing.length > 0) {
    resolvedUserEvmAddress = existing[0].userEvmAddress;
  } else if (userEvmAddress && ethers.isAddress(userEvmAddress)) {
    if (!credential) {
      res.status(400).json({
        error: "BAD_REQUEST",
        message: "credential is required when providing userEvmAddress",
      });
      return;
    }
    const recovered = ethers.verifyMessage(`flow-auth:${flowAccountId}`, credential);
    if (recovered.toLowerCase() !== userEvmAddress.toLowerCase()) {
      res.status(401).json({
        error: "UNAUTHORIZED",
        message: "credential signature does not match userEvmAddress",
      });
      return;
    }
    resolvedUserEvmAddress = ethers.getAddress(recovered);
  } else {
    const custodial = createCustodialWallet();
    resolvedUserEvmAddress = custodial.address;
    custodialPrivateKeyCiphertext = custodial.privateKeyCiphertext;
  }

  if (isNewUser) {
    await db.insert(userWalletsTable).values({
      flowAddress: flowAccountId,
      userEvmAddress: resolvedUserEvmAddress,
      custodialPrivateKeyCiphertext,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
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

  res.json({
    userAddress: flowAccountId,
    displayName,
    flowAccountId,
    userEvmAddress: resolvedUserEvmAddress,
    sessionToken,
    isNewUser,
  });
});

export default router;
