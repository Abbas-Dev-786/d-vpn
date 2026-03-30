import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { ethers } from "ethers";

const router: IRouter = Router();
const userIdentityMap = new Map<string, string>();

const createMockEvmAddress = (): string => {
  const hex = randomUUID().replace(/-/g, "").padEnd(40, "0").slice(0, 40);
  return ethers.getAddress(`0x${hex}`);
};

router.post("/auth/flow", (req, res) => {
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

  const isNewUser = !userAddress;
  const flowAccountId = userAddress ?? `0x${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  let resolvedUserEvmAddress = userIdentityMap.get(flowAccountId);
  if (!resolvedUserEvmAddress) {
    resolvedUserEvmAddress =
      userEvmAddress && ethers.isAddress(userEvmAddress)
        ? ethers.getAddress(userEvmAddress)
        : createMockEvmAddress();
    userIdentityMap.set(flowAccountId, resolvedUserEvmAddress);
  }
  const displayName =
    method === "google"
      ? "Demo User (Google)"
      : method === "apple"
        ? "Demo User (Apple)"
        : method === "passkey"
          ? "Demo User (Passkey)"
          : "Demo User (Email)";

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
