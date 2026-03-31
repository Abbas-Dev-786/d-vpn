import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { ethers } from "ethers";
import { getRuntimeConfig } from "../config/runtime";

const runtime = getRuntimeConfig();

const deriveAesKey = (): Buffer =>
  createHash("sha256").update(runtime.custodialKeyEncryptionSecret).digest();

export const createCustodialWallet = (): { address: string; privateKeyCiphertext: string } => {
  const wallet = ethers.Wallet.createRandom();
  return {
    address: wallet.address,
    privateKeyCiphertext: encryptPrivateKey(wallet.privateKey),
  };
};

export const encryptPrivateKey = (privateKey: string): string => {
  const key = deriveAesKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${ciphertext.toString("hex")}`;
};

export const decryptPrivateKey = (encoded: string): string => {
  const [ivHex, tagHex, cipherHex] = encoded.split(":");
  if (!ivHex || !tagHex || !cipherHex) {
    throw new Error("Invalid private key ciphertext format");
  }
  const key = deriveAesKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(cipherHex, "hex")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
};

