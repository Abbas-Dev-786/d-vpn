import { SepoliaConfigV2, createInstance, initSDK } from "@zama-fhe/relayer-sdk/web";
import { ethers } from "ethers";

export type EncryptedInputPayload = {
  handle: string;
  inputProof: string;
  importerAddress: string;
  source: "relayer-sdk";
};

let instancePromise: Promise<any> | null = null;
let sdkInitPromise: Promise<unknown> | null = null;
const FALLBACK_RPC_URLS = [
  import.meta.env.VITE_ZAMA_RPC_URL,
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://sepolia.drpc.org",
].filter((v): v is string => !!v);

const requiredEnv = (name: string): string => {
  const value = import.meta.env[name];
  if (!value || typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required frontend env: ${name}`);
  }
  return value.trim();
};

const normalizeRelayerUrl = (url?: string): string => {
  const base = (url ?? SepoliaConfigV2.relayerUrl).replace(/\/$/, "");
  if (base.endsWith("/v1") || base.endsWith("/v2")) return base;
  return `${base}/v2`;
};

const normalizeAddress = (value: string): string => {
  if (ethers.isAddress(value)) return ethers.getAddress(value);
  throw new Error("Invalid address in frontend env configuration");
};

export const getDvpnContractAddress = (): string =>
  normalizeAddress(requiredEnv("VITE_DVPN_CONTRACT_ADDRESS"));

export const getImporterAddress = (): string =>
  normalizeAddress(requiredEnv("VITE_ZAMA_IMPORTER_ADDRESS"));

export const getFhevmInstance = async () => {
  if (!instancePromise) {
    instancePromise = (async () => {
      let lastError: unknown = null;

      if (!sdkInitPromise) {
        sdkInitPromise = initSDK({ thread: 1 }).catch((err) => {
          sdkInitPromise = null;
          throw err;
        });
      }
      await sdkInitPromise;

      const relayerUrl = normalizeRelayerUrl(
        requiredEnv("VITE_ZAMA_RELAYER_URL"),
      );

      for (const rpc of FALLBACK_RPC_URLS) {
        try {
          return await createInstance({
            ...SepoliaConfigV2,
            network: rpc,
            relayerUrl,
          });
        } catch (err) {
          lastError = err;
        }
      }

      throw lastError ?? new Error("Unable to initialize Zama relayer SDK");
    })().catch((err) => {
      instancePromise = null;
      throw err;
    });
  }
  return instancePromise;
};

export const encryptSessionTime = async (
  contractAddress: string,
  importerAddress: string,
  value: number | bigint,
): Promise<EncryptedInputPayload> => {
  try {
    const instance = await getFhevmInstance();
    const input = instance.createEncryptedInput(contractAddress, importerAddress);
    input.add64(BigInt(value));
    const encrypted = await input.encrypt();
    const handleHex = ethers.hexlify(encrypted.handles[0]);
    const proofHex = ethers.hexlify(encrypted.inputProof);

    return {
      handle: handleHex,
      inputProof: proofHex,
      importerAddress,
      source: "relayer-sdk",
    };
  } catch (err: any) {
    const message =
      typeof err?.message === "string"
        ? err.message
        : "Failed to initialize relayer SDK or encrypt payload";
    throw new Error(message);
  }
};

export function truncateFhe(hash: string | null | undefined): string {
  if (!hash || hash.length < 10) return hash || "0x0";
  return `${hash.substring(0, 8)}...${hash.substring(hash.length - 6)}`;
}
