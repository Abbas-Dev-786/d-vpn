/**
 * Utility functions for FHE (Fully Homomorphic Encryption) values
 */
import { createInstance } from "fhevmjs";

let fhevmInstance: any | null = null;

export const initFhevm = async (
  networkUrl: string = "https://devnet.zama.ai",
): Promise<any> => {
  if (fhevmInstance) return fhevmInstance;

  try {
    // We use the official Zama devnet RPC which automatically furnishes the FHE public key
    // and natively routes the ACL/KMS calls without manual address specification.
    // @ts-ignore - fhevmjs v0.4 typing is overly strict, but devnet RPC auto-resolves addresses
    fhevmInstance = await createInstance({
      networkUrl,
    });
    console.log("FHEVM instance initialized");
  } catch (error) {
    console.error("Failed to initialize FhevmInstance", error);
    throw error;
  }

  return fhevmInstance;
};

export const encryptSessionTime = async (
  contractAddress: string,
  userAddress: string,
  value: number | bigint,
) => {
  const instance = await initFhevm();

  // Create an encrypted input buffer bound to the contract and user
  const input = instance.createEncryptedInput(contractAddress, userAddress);

  // Zama fhEVM `euint64` uses `add64`
  input.add64(BigInt(value));

  // Encrypt the payload and generate the ZKP
  const encrypted = await input.encrypt();

  return {
    handle: encrypted.handles[0],
    inputProof: encrypted.inputProof,
  };
};

export const getFhevmInstance = () => fhevmInstance;

export function generateFheHash(): string {
  const chars = "0123456789abcdef";
  let hash = "0x";
  for (let i = 0; i < 64; i++) {
    hash += chars[Math.floor(Math.random() * chars.length)];
  }
  return hash;
}

export function truncateFhe(hash: string | null | undefined): string {
  if (!hash || hash.length < 10) return hash || "0x0";
  return `${hash.substring(0, 8)}...${hash.substring(hash.length - 6)}`;
}
