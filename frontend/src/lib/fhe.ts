import { SepoliaConfig, createInstance } from "@zama-fhe/relayer-sdk/web";
import { ethers } from "ethers";

export type EncryptedInputPayload = {
  handle: string;
  inputProof: string;
  importerAddress: string;
  source: "relayer-sdk";
};

let instancePromise: Promise<any> | null = null;

const normalizeAddress = (value: string, fallback: string): string => {
  if (ethers.isAddress(value)) return ethers.getAddress(value);
  return ethers.getAddress(fallback);
};

export const getDvpnContractAddress = (): string =>
  normalizeAddress(
    import.meta.env.VITE_DVPN_CONTRACT_ADDRESS ?? "",
    "0x0000000000000000000000000000000000000001",
  );

export const getImporterAddress = (): string =>
  normalizeAddress(
    import.meta.env.VITE_ZAMA_IMPORTER_ADDRESS ?? "",
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  );

export const getFhevmInstance = async () => {
  if (!instancePromise) {
    instancePromise = createInstance({
      ...SepoliaConfig,
      network:
        import.meta.env.VITE_ZAMA_RPC_URL ?? "https://eth-sepolia.public.blastapi.io",
    });
  }
  return instancePromise;
};

export const encryptSessionTime = async (
  contractAddress: string,
  importerAddress: string,
  value: number | bigint,
): Promise<EncryptedInputPayload> => {
  const instance = await getFhevmInstance();
  const input = instance.createEncryptedInput(contractAddress, importerAddress);
  input.add64(BigInt(value));
  const encrypted = await input.encrypt();

  return {
    handle: encrypted.handles[0],
    inputProof: encrypted.inputProof,
    importerAddress,
    source: "relayer-sdk",
  };
};

export function truncateFhe(hash: string | null | undefined): string {
  if (!hash || hash.length < 10) return hash || "0x0";
  return `${hash.substring(0, 8)}...${hash.substring(hash.length - 6)}`;
}
