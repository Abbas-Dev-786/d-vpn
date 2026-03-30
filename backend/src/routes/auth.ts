import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";

const router: IRouter = Router();

router.post("/auth/flow", (req, res) => {
  const { method, credential, userAddress } = req.body as {
    method: string;
    credential?: string;
    userAddress?: string;
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
    sessionToken,
    isNewUser,
  });
});

export default router;
