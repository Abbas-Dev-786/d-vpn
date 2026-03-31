import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger.js";

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
}

export const errorHandler = (
  err: ApiError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  const errorCode = err.code || "INTERNAL_ERROR";

  // Log the error with request context using Pino
  logger.error(
    {
      err,
      method: req.method,
      url: req.originalUrl,
      body: req.body,
      params: req.params,
      query: req.query,
    },
    "Unhandled error occurred"
  );

  res.status(statusCode).json({
    error: errorCode,
    message,
    // Include stack trace only in development
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
};
