import { ethers } from "ethers";

type RuntimeConfig = {
  zamaRpcUrl: string;
  zamaRelayerPrivateKey: string;
  dvpnContractAddress: string;
  flowEvmRpcUrl: string;
  flowEvmChainId: number;
  flowSettlerPrivateKey: string;
  flowTreasuryAddress: string;
  flowCadenceAccessNode: string;
  flowCadenceNetwork: string;
  flowSchedulerAddress: string;
  flowSchedulerPrivateKey: string;
  flowSchedulerKeyIndex: number;
  flowCronAddress: string;
  flowCronUtilsAddress: string;
  flowTransactionSchedulerAddress: string;
  flowTransactionSchedulerUtilsAddress: string;
  flowTokenAddress: string;
  fungibleTokenAddress: string;
  evmCadenceAddress: string;
  custodialKeyEncryptionSecret: string;
};

const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
};

const requiredAddressEnv = (name: string): string => {
  const value = requiredEnv(name);
  if (!ethers.isAddress(value)) {
    throw new Error(`Invalid address in ${name}`);
  }
  return ethers.getAddress(value);
};

const normalizeHexAddress = (value: string): string => {
  if (!value.startsWith("0x")) {
    return `0x${value}`;
  }
  return value;
};

const requiredFlowCadenceAddressEnv = (name: string, fallback?: string): string => {
  const raw = (process.env[name] ?? fallback ?? "").trim();
  if (!raw) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  const value = normalizeHexAddress(raw);
  if (!/^0x[0-9a-fA-F]{16}$/.test(value)) {
    throw new Error(`Invalid Flow Cadence address in ${name}. Expected 8-byte hex (0x + 16 chars).`);
  }
  return `0x${value.slice(2).toLowerCase()}`;
};

const requiredPrivateKeyEnv = (name: string): string => {
  const value = normalizeHexAddress(requiredEnv(name));
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`Invalid private key format in ${name}`);
  }
  return value;
};

let cachedConfig: RuntimeConfig | null = null;

export const getRuntimeConfig = (): RuntimeConfig => {
  if (cachedConfig) return cachedConfig;

  const zamaRpcUrl = requiredEnv("ZAMA_RPC_URL");
  const zamaRelayerPrivateKey = requiredPrivateKeyEnv("RELAYER_PRIVATE_KEY");
  const dvpnContractAddress = requiredAddressEnv("DVPN_CONTRACT_ADDRESS");

  const flowEvmRpcUrl = requiredEnv("FLOW_EVM_RPC_URL");
  const flowEvmChainIdRaw = requiredEnv("FLOW_EVM_CHAIN_ID");
  const flowEvmChainId = Number(flowEvmChainIdRaw);
  if (!Number.isInteger(flowEvmChainId) || flowEvmChainId <= 0) {
    throw new Error("Invalid FLOW_EVM_CHAIN_ID");
  }

  const flowSettlerPrivateKey = requiredPrivateKeyEnv("FLOW_SETTLER_PRIVATE_KEY");
  const flowTreasuryAddress = requiredAddressEnv("FLOW_TREASURY_ADDRESS");
  const flowCadenceAccessNode = requiredEnv("FLOW_CADENCE_ACCESS_NODE");
  const flowCadenceNetwork = process.env.FLOW_CADENCE_NETWORK?.trim() || "testnet";
  const flowSchedulerAddress = requiredFlowCadenceAddressEnv("FLOW_SCHEDULER_ADDRESS");
  const flowSchedulerPrivateKey = requiredPrivateKeyEnv("FLOW_SCHEDULER_PRIVATE_KEY");
  const flowSchedulerKeyIndexRaw = process.env.FLOW_SCHEDULER_KEY_INDEX?.trim() || "0";
  const flowSchedulerKeyIndex = Number(flowSchedulerKeyIndexRaw);
  if (!Number.isInteger(flowSchedulerKeyIndex) || flowSchedulerKeyIndex < 0) {
    throw new Error("Invalid FLOW_SCHEDULER_KEY_INDEX");
  }

  const flowCronAddress = requiredFlowCadenceAddressEnv(
    "FLOW_CRON_ADDRESS",
    "0x5cbfdec870ee216d",
  );
  const flowCronUtilsAddress = requiredFlowCadenceAddressEnv(
    "FLOW_CRON_UTILS_ADDRESS",
    "0x5cbfdec870ee216d",
  );
  const flowTransactionSchedulerAddress = requiredFlowCadenceAddressEnv(
    "FLOW_TRANSACTION_SCHEDULER_ADDRESS",
    "0x8c5303eaa26202d6",
  );
  const flowTransactionSchedulerUtilsAddress = requiredFlowCadenceAddressEnv(
    "FLOW_TRANSACTION_SCHEDULER_UTILS_ADDRESS",
    "0x8c5303eaa26202d6",
  );
  const flowTokenAddress = requiredFlowCadenceAddressEnv(
    "FLOW_TOKEN_ADDRESS",
    "0x7e60df042a9c0868",
  );
  const fungibleTokenAddress = requiredFlowCadenceAddressEnv(
    "FUNGIBLE_TOKEN_ADDRESS",
    "0x9a0766d93b6608b7",
  );
  const evmCadenceAddress = requiredFlowCadenceAddressEnv(
    "FLOW_EVM_CADENCE_ADDRESS",
    "0x8c5303eaa26202d6",
  );

  const custodialKeyEncryptionSecret = requiredEnv("CUSTODIAL_KEY_ENCRYPTION_SECRET");
  if (custodialKeyEncryptionSecret.length < 32) {
    throw new Error("CUSTODIAL_KEY_ENCRYPTION_SECRET must be at least 32 characters");
  }

  cachedConfig = {
    zamaRpcUrl,
    zamaRelayerPrivateKey,
    dvpnContractAddress,
    flowEvmRpcUrl,
    flowEvmChainId,
    flowSettlerPrivateKey,
    flowTreasuryAddress,
    flowCadenceAccessNode,
    flowCadenceNetwork,
    flowSchedulerAddress,
    flowSchedulerPrivateKey,
    flowSchedulerKeyIndex,
    flowCronAddress,
    flowCronUtilsAddress,
    flowTransactionSchedulerAddress,
    flowTransactionSchedulerUtilsAddress,
    flowTokenAddress,
    fungibleTokenAddress,
    evmCadenceAddress,
    custodialKeyEncryptionSecret,
  };

  return cachedConfig;
};

export const assertCriticalRuntimeConfig = (): void => {
  getRuntimeConfig();
};
