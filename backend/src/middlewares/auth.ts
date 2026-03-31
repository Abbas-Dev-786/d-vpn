import { eq, and, gt } from "drizzle-orm";
import { db } from "../config/db.js";
import { authSessionsTable } from "../schema/index.js";
import { asyncHandler } from "../lib/async-handler.js";
import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";

export const authMiddleware = asyncHandler(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Missing or invalid authorization header" });
    return;
  }

  const token = authHeader.split(" ")[1];
  const now = new Date();

  const [session] = await db
    .select()
    .from(authSessionsTable)
    .where(and(
      eq(authSessionsTable.sessionToken, token),
      gt(authSessionsTable.expiresAt, now)
    ))
    .limit(1);

  if (!session) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Invalid or expired session" });
    return;
  }

  req.user = {
    flowAddress: session.flowAddress,
  };

  next();
});
