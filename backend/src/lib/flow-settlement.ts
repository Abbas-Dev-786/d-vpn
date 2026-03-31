import { ethers } from "ethers";
import { logger } from "./logger.js";
import { getRuntimeConfig } from "../config/runtime.js";

const runtime = getRuntimeConfig();
const FLOW_RATE_PER_SECOND = process.env.FLOW_RATE_PER_SECOND || "0.00001";
const FLOW_MAX_PAYOUT_PER_SESSION = process.env.FLOW_MAX_PAYOUT_PER_SESSION || "0.05";

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

const normalizeReason = (reason: string): string =>
  reason.length > 250 ? `${reason.slice(0, 247)}...` : reason;

const initFlowSettler = (): void => {
  if (flowProvider) return;

  flowProvider = new ethers.JsonRpcProvider(runtime.flowEvmRpcUrl, {
    chainId: runtime.flowEvmChainId,
    name: "flow-evm",
  });
  flowSettlerWallet = new ethers.Wallet(runtime.flowSettlerPrivateKey, flowProvider);
  if (flowSettlerWallet.address.toLowerCase() !== runtime.flowTreasuryAddress.toLowerCase()) {
    throw new Error("FLOW_SETTLER_PRIVATE_KEY does not match FLOW_TREASURY_ADDRESS");
  }

  logger.info(
    {
      address: flowSettlerWallet.address,
      rpcUrl: runtime.flowEvmRpcUrl,
      chainId: runtime.flowEvmChainId,
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

export const transferFlowFromTreasury = async (args: {
  recipientAddress: string;
  amountFlow: string;
  context: string;
}): Promise<{ txHash: string }> => {
  const { recipientAddress, amountFlow, context } = args;
  if (!ethers.isAddress(recipientAddress)) {
    throw new Error("Invalid recipientAddress");
  }
  const wei = ethers.parseUnits(amountFlow, 18);
  if (wei <= 0n) {
    throw new Error("amountFlow must be greater than zero");
  }

  initFlowSettler();
  if (!flowSettlerWallet) {
    throw new Error("Flow settlement wallet is not configured");
  }

  try {
    const tx = await flowSettlerWallet.sendTransaction({
      to: ethers.getAddress(recipientAddress),
      value: wei,
    });
    await tx.wait();

    logger.info({ context, recipientAddress, amountFlow, txHash: tx.hash }, "Flow transfer confirmed");
    return { txHash: tx.hash };
  } catch (err: any) {
    const reason = normalizeReason(err?.message ?? "Unknown Flow transfer failure");
    logger.error({ err, context, recipientAddress, amountFlow }, "Flow transfer failed");
    throw new Error(reason);
  }
};
