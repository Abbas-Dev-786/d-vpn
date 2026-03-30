import { ethers } from "ethers";
import { logger } from "./logger";
import DVPN from "./DVPN.json";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MOCK_CONTRACT_ADDRESS = "0x0000000000000000000000000000000000000001";
const DEFAULT_RELAYER = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// In production these should be injected from `.env`.
const RPC_URL = process.env.ZAMA_RPC_URL || "https://eth-sepolia.public.blastapi.io";
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY || DEFAULT_RELAYER;
const CONTRACT_ADDRESS = process.env.DVPN_CONTRACT_ADDRESS || MOCK_CONTRACT_ADDRESS;
const MOCK_MODE = process.env.ZAMA_MOCK_MODE === "true" || CONTRACT_ADDRESS === MOCK_CONTRACT_ADDRESS;

export type EncryptedInputPayload = {
  handle: string;
  inputProof: string;
  importerAddress: string;
  source?: "relayer-sdk";
};

let provider: ethers.Provider;
let relayerWallet: ethers.Wallet;
let dvpnContract: ethers.Contract;

const parseAndValidatePayload = (payload: EncryptedInputPayload | string): EncryptedInputPayload => {
  const raw = typeof payload === "string" ? JSON.parse(payload) : payload;
  const typed = raw as Partial<EncryptedInputPayload>;

  if (!typed.handle || !ethers.isHexString(typed.handle, 32)) {
    throw new Error("Invalid encrypted payload handle");
  }
  if (!typed.inputProof || !ethers.isHexString(typed.inputProof)) {
    throw new Error("Invalid encrypted payload proof");
  }
  if (!typed.importerAddress || !ethers.isAddress(typed.importerAddress)) {
    throw new Error("Invalid encrypted payload importerAddress");
  }

  return {
    handle: typed.handle,
    inputProof: typed.inputProof,
    importerAddress: typed.importerAddress,
    source: typed.source ?? "relayer-sdk",
  };
};

export const initRelayer = () => {
  if (provider) return;

  try {
    provider = new ethers.JsonRpcProvider(RPC_URL);
    relayerWallet = new ethers.Wallet(RELAYER_PRIVATE_KEY, provider);
    dvpnContract = new ethers.Contract(CONTRACT_ADDRESS, DVPN.abi, relayerWallet);
    logger.info({ address: relayerWallet.address, contractAddress: CONTRACT_ADDRESS, mock: MOCK_MODE }, "Zama Trusted Relayer Initialized");
  } catch (err) {
    logger.error({ err }, "Failed to initialize Zama Trusted Relayer");
  }
};

/**
 * Acts as the trusted relayer to start a session on the Zama fhEVM network.
 * Allows the user to authenticate via their Flow Passkey while the backend pays the Sepolia/Zama gas.
 */
export const startSessionOnChain = async (
  userEvmAddress: string,
  nodeProviderEvmAddress: string,
  encryptedPayload: EncryptedInputPayload | string,
): Promise<string> => {
  initRelayer();

  try {
    if (!ethers.isAddress(userEvmAddress) || !ethers.isAddress(nodeProviderEvmAddress)) {
      throw new Error("Invalid EVM address for user or provider");
    }
    const payload = parseAndValidatePayload(encryptedPayload);
    if (payload.importerAddress.toLowerCase() !== relayerWallet.address.toLowerCase()) {
      throw new Error("Encrypted payload importer must match relayer wallet");
    }

    logger.info({ userEvmAddress, nodeProviderEvmAddress, importerAddress: payload.importerAddress }, "Relaying startSession to Zama fhEVM...");

    if (MOCK_MODE) {
      logger.info("Mock Contract interaction. Simulating transaction success.");
      return "0xMOCK_TX_HASH_START";
    }

    const tx = await dvpnContract.startSession(userEvmAddress, nodeProviderEvmAddress, payload.handle, payload.inputProof);
    await tx.wait();

    return tx.hash;
  } catch (err: any) {
    logger.error({ err, userEvmAddress, nodeProviderEvmAddress }, "FHE Relayer: Failed to start session on-chain");
    throw new Error(`Zama Relayer Error: ${err.message}`);
  }
};

/**
 * Acts as the trusted relayer to end a session on the Zama fhEVM network.
 * The contract homomorphically calculates duration and payment values blindly.
 */
export const endSessionOnChain = async (
  userEvmAddress: string,
  encryptedPayload: EncryptedInputPayload | string,
): Promise<string> => {
  initRelayer();

  try {
    if (!ethers.isAddress(userEvmAddress)) {
      throw new Error("Invalid EVM address for user");
    }
    const payload = parseAndValidatePayload(encryptedPayload);
    if (payload.importerAddress.toLowerCase() !== relayerWallet.address.toLowerCase()) {
      throw new Error("Encrypted payload importer must match relayer wallet");
    }

    logger.info({ userEvmAddress, importerAddress: payload.importerAddress }, "Relaying endConfidentialSession to Zama fhEVM...");

    if (MOCK_MODE) {
      logger.info("Mock Contract interaction. Simulating transaction success.");
      return "0xMOCK_TX_HASH_END";
    }

    const tx = await dvpnContract.endConfidentialSession(userEvmAddress, payload.handle, payload.inputProof);
    await tx.wait();

    return tx.hash;
  } catch (err: any) {
    logger.error({ err, userEvmAddress }, "FHE Relayer: Failed to end session on-chain");
    throw new Error(`Zama Relayer Error: ${err.message}`);
  }
};

export const getTrustedRelayerAddress = (): string => {
  initRelayer();
  return relayerWallet.address;
};

export const getConfiguredContractAddress = (): string => CONTRACT_ADDRESS;
export const isMockMode = (): boolean => MOCK_MODE;
export const getDefaultRelayerAddress = (): string => new ethers.Wallet(DEFAULT_RELAYER).address;
export const getZeroAddress = (): string => ZERO_ADDRESS;
