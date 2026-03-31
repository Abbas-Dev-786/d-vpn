import { ethers } from "ethers";
import { logger } from "./logger.js";
import DVPN from "./DVPN.json" with { type: "json" };
import { getRuntimeConfig } from "../config/runtime.js";

const runtime = getRuntimeConfig();

export type EncryptedInputPayload = {
  handle: string;
  inputProof: string;
  importerAddress: string;
  source?: "relayer-sdk";
};

let provider: ethers.Provider;
let relayerWallet: ethers.Wallet;
let dvpnContract: ethers.Contract;

const bytesLikeToHex = (
  value: unknown,
  fieldName: string,
  expectedBytesLength?: number,
): string => {
  if (typeof value === "string") {
    if (!ethers.isHexString(value, expectedBytesLength)) {
      throw new Error(`Invalid ${fieldName}`);
    }
    return value;
  }

  if (value instanceof Uint8Array || Array.isArray(value)) {
    const bytes = value instanceof Uint8Array ? value : Uint8Array.from(value as number[]);
    const hex = ethers.hexlify(bytes);
    if (!ethers.isHexString(hex, expectedBytesLength)) {
      throw new Error(`Invalid ${fieldName}`);
    }
    return hex;
  }

  if (value && typeof value === "object") {
    const indexedEntries = Object.entries(value as Record<string, unknown>)
      .filter(([k]) => /^\d+$/.test(k))
      .sort((a, b) => Number(a[0]) - Number(b[0]));

    if (indexedEntries.length > 0) {
      const bytes = Uint8Array.from(indexedEntries.map(([, v]) => Number(v)));
      const hex = ethers.hexlify(bytes);
      if (!ethers.isHexString(hex, expectedBytesLength)) {
        throw new Error(`Invalid ${fieldName}`);
      }
      return hex;
    }
  }

  throw new Error(`Invalid ${fieldName}`);
};

const parseAndValidatePayload = (payload: EncryptedInputPayload | string): EncryptedInputPayload => {
  const raw = typeof payload === "string" ? JSON.parse(payload) : payload;
  const typed = raw as Partial<EncryptedInputPayload>;

  const handle = bytesLikeToHex(typed.handle, "encrypted payload handle", 32);
  const inputProof = bytesLikeToHex(typed.inputProof, "encrypted payload proof");
  if (!typed.importerAddress || !ethers.isAddress(typed.importerAddress)) {
    throw new Error("Invalid encrypted payload importerAddress");
  }

  return {
    handle,
    inputProof,
    importerAddress: typed.importerAddress,
    source: typed.source ?? "relayer-sdk",
  };
};

export const initRelayer = () => {
  if (provider) return;

  try {
    provider = new ethers.JsonRpcProvider(runtime.zamaRpcUrl);
    relayerWallet = new ethers.Wallet(runtime.zamaRelayerPrivateKey, provider);
    dvpnContract = new ethers.Contract(runtime.dvpnContractAddress, DVPN.abi, relayerWallet);
    logger.info(
      { address: relayerWallet.address, contractAddress: runtime.dvpnContractAddress },
      "Zama Trusted Relayer Initialized",
    );
  } catch (err) {
    logger.error({ err }, "Failed to initialize Zama Trusted Relayer");
    throw err;
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

export const getConfiguredContractAddress = (): string => runtime.dvpnContractAddress;
