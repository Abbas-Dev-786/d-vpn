import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import sessionsRouter from "./sessions.js";
import nodesRouter from "./nodes.js";
import paymentsRouter from "./payments.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(sessionsRouter);
router.use(nodesRouter);
router.use(paymentsRouter);

export default router;
