import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * A wrapper to handle async request handlers and pass errors to the global error middleware.
 */
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
