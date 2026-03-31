import { ethers } from "ethers";

type RuntimeConfig = {
  zamaRpcUrl: string;
  zamaRelayerPrivateKey: string;
  dvpnContractAddress: string;
  flowEvmRpcUrl: string;
  flowEvmChainId: number;
  flowSettlerPrivateKey: string;
  flowTreasuryAddress: string;
  flowSchedulerApiUrl: string;
  flowSchedulerApiKey: string;
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

const requiredPrivateKeyEnv = (name: string): string => {
  const value = requiredEnv(name);
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
  const flowSchedulerApiUrl = requiredEnv("FLOW_SCHEDULER_API_URL");
  const flowSchedulerApiKey = requiredEnv("FLOW_SCHEDULER_API_KEY");

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
    flowSchedulerApiUrl,
    flowSchedulerApiKey,
    custodialKeyEncryptionSecret,
  };

  return cachedConfig;
};

export const assertCriticalRuntimeConfig = (): void => {
  getRuntimeConfig();
};

