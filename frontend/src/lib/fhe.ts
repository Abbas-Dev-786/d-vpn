/**
 * Utility functions to simulate FHE (Fully Homomorphic Encryption) values
 * For demo purposes, we generate realistic looking hex ciphertext strings.
 */

export function generateFheHash(): string {
  const chars = '0123456789abcdef';
  let hash = '0x';
  for (let i = 0; i < 64; i++) {
    hash += chars[Math.floor(Math.random() * chars.length)];
  }
  return hash;
}

export function truncateFhe(hash: string | null | undefined): string {
  if (!hash || hash.length < 10) return hash || '0x0';
  return `${hash.substring(0, 8)}...${hash.substring(hash.length - 6)}`;
}
