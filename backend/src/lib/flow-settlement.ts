import { createHash } from "crypto";
import { ethers } from "ethers";
import { logger } from "./logger";

const DEFAULT_FLOW_RPC_URL = "https://testnet.evm.nodes.onflow.org";
const DEFAULT_FLOW_CHAIN_ID = 545;
const MOCK_SETTLEMENT_HASH_PREFIX = "0x";

const FLOW_EVM_RPC_URL = process.env.FLOW_EVM_RPC_URL || DEFAULT_FLOW_RPC_URL;
const FLOW_EVM_CHAIN_ID = Number(process.env.FLOW_EVM_CHAIN_ID || DEFAULT_FLOW_CHAIN_ID);
const FLOW_SETTLER_PRIVATE_KEY = process.env.FLOW_SETTLER_PRIVATE_KEY;
const FLOW_RATE_PER_SECOND = process.env.FLOW_RATE_PER_SECOND || "0.00001";
const FLOW_MAX_PAYOUT_PER_SESSION = process.env.FLOW_MAX_PAYOUT_PER_SESSION || "0.05";
const FLOW_MOCK_MODE =
  process.env.FLOW_MOCK_MODE === "true" ||
  !FLOW_SETTLER_PRIVATE_KEY;

export type SettlementStatus = "submitted" | "failed";

export type FlowSettlementResult = {
  settlementStatus: SettlementStatus;
  settlementTxHash: string | null;
  settlementFailureReason: string | null;
  settlementAmountFlow: string;
  settlementToken: "FLOW";
  settlementAttemptCount: number;
  settledAt: Date | null;
};

let flowProvider: ethers.Provider | null = null;
let flowSettlerWallet: ethers.Wallet | null = null;

const buildMockTxHash = (sessionId: string): string => {
  const digest = createHash("sha256").update(`flow-settlement:${sessionId}`).digest("hex");
  return `${MOCK_SETTLEMENT_HASH_PREFIX}${digest}`;
};

const normalizeReason = (reason: string): string =>
  reason.length > 250 ? `${reason.slice(0, 247)}...` : reason;

const initFlowSettler = (): void => {
  if (flowProvider || FLOW_MOCK_MODE) return;

  flowProvider = new ethers.JsonRpcProvider(FLOW_EVM_RPC_URL, {
    chainId: FLOW_EVM_CHAIN_ID,
    name: "flow-evm",
  });
  flowSettlerWallet = new ethers.Wallet(FLOW_SETTLER_PRIVATE_KEY as string, flowProvider);

  logger.info(
    {
      address: flowSettlerWallet.address,
      rpcUrl: FLOW_EVM_RPC_URL,
      chainId: FLOW_EVM_CHAIN_ID,
      mockMode: FLOW_MOCK_MODE,
    },
    "Flow settlement relayer initialized",
  );
};

export const computeFlowAmount = (durationSeconds: number): { amountFlow: string; amountWei: bigint } => {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("durationSeconds must be greater than 0");
  }

  const perSecondWei = ethers.parseUnits(FLOW_RATE_PER_SECOND, 18);
  const maxPayoutWei = ethers.parseUnits(FLOW_MAX_PAYOUT_PER_SESSION, 18);
  const amountWei = perSecondWei * BigInt(Math.ceil(durationSeconds));
  const cappedWei = amountWei > maxPayoutWei ? maxPayoutWei : amountWei;

  return {
    amountWei: cappedWei,
    amountFlow: ethers.formatUnits(cappedWei, 18),
  };
};

export const settleFlowForSession = async (args: {
  sessionId: string;
  providerFlowAddress: string;
  durationSeconds: number;
}): Promise<FlowSettlementResult> => {
  const { sessionId, providerFlowAddress, durationSeconds } = args;

  if (!ethers.isAddress(providerFlowAddress)) {
    return {
      settlementStatus: "failed",
      settlementTxHash: null,
      settlementFailureReason: "Invalid provider Flow address",
      settlementAmountFlow: "0",
      settlementToken: "FLOW",
      settlementAttemptCount: 1,
      settledAt: null,
    };
  }

  const { amountWei, amountFlow } = computeFlowAmount(durationSeconds);
  if (amountWei <= 0n) {
    return {
      settlementStatus: "failed",
      settlementTxHash: null,
      settlementFailureReason: "Computed payout is zero",
      settlementAmountFlow: amountFlow,
      settlementToken: "FLOW",
      settlementAttemptCount: 1,
      settledAt: null,
    };
  }

  if (FLOW_MOCK_MODE) {
    logger.info(
      { sessionId, providerFlowAddress, amountFlow },
      "FLOW settlement running in mock mode",
    );
    return {
      settlementStatus: "submitted",
      settlementTxHash: buildMockTxHash(sessionId),
      settlementFailureReason: null,
      settlementAmountFlow: amountFlow,
      settlementToken: "FLOW",
      settlementAttemptCount: 1,
      settledAt: new Date(),
    };
  }

  initFlowSettler();
  if (!flowSettlerWallet) {
    return {
      settlementStatus: "failed",
      settlementTxHash: null,
      settlementFailureReason: "Flow settlement wallet is not configured",
      settlementAmountFlow: amountFlow,
      settlementToken: "FLOW",
      settlementAttemptCount: 1,
      settledAt: null,
    };
  }

  try {
    const tx = await flowSettlerWallet.sendTransaction({
      to: ethers.getAddress(providerFlowAddress),
      value: amountWei,
    });
    await tx.wait();

    return {
      settlementStatus: "submitted",
      settlementTxHash: tx.hash,
      settlementFailureReason: null,
      settlementAmountFlow: amountFlow,
      settlementToken: "FLOW",
      settlementAttemptCount: 1,
      settledAt: new Date(),
    };
  } catch (err: any) {
    const reason = normalizeReason(err?.message ?? "Unknown Flow settlement failure");
    logger.error(
      { err, sessionId, providerFlowAddress, amountFlow },
      "Flow settlement failed",
    );
    return {
      settlementStatus: "failed",
      settlementTxHash: null,
      settlementFailureReason: reason,
      settlementAmountFlow: amountFlow,
      settlementToken: "FLOW",
      settlementAttemptCount: 1,
      settledAt: null,
    };
  }
};
