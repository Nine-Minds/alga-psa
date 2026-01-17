/**
 * @alga-psa/core - Encryption Utilities
 *
 * Password hashing and verification using PBKDF2 with WebCrypto API.
 * Works in both Node.js and Edge runtimes.
 */

import { getSecret } from './secrets';

// Utility: encode string to Uint8Array
const te = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const h = bytes[i].toString(16).padStart(2, '0');
    hex += h;
  }
  return hex;
}

function randomHex(byteLength: number): string {
  const arr = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(arr);
  return toHex(arr.buffer);
}

async function pbkdf2Hex(password: string, salt: string, iterations: number, keyLength: number, digest: string): Promise<string> {
  // Map Node digest names to WebCrypto ones
  const algo = digest.toUpperCase() === 'SHA512' || digest.toUpperCase() === 'SHA-512' ? 'SHA-512'
             : digest.toUpperCase() === 'SHA256' || digest.toUpperCase() === 'SHA-256' ? 'SHA-256'
             : 'SHA-512';

  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    te.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: algo,
      iterations,
      salt: te.encode(salt),
    },
    keyMaterial,
    keyLength * 8
  );

  return toHex(bits);
}

/**
 * Hash a password using PBKDF2 with a random salt
 * @param password - The plain text password to hash
 * @returns A string in the format "salt:hash"
 */
export async function hashPassword(password: string): Promise<string> {
  const key = await getSecret('nextauth_secret', 'NEXTAUTH_SECRET');
  if (!key) {
    throw new Error('Failed to retrieve the encryption key from the secret provider');
  }

  const saltBytes = Number(process.env.SALT_BYTES) || 12;
  const iterations = Number(process.env.ITERATIONS) || 10000;
  const keyLength = Number(process.env.KEY_LENGTH) || 64;
  const digest = process.env.ALGORITHM || 'sha512';

  const salt = randomHex(saltBytes);
  const hash = await pbkdf2Hex(password, key + salt, iterations, keyLength, digest);
  return `${salt}:${hash}`;
}

/**
 * Verify a password against a stored hash
 * @param password - The plain text password to verify
 * @param storedHash - The stored hash in the format "salt:hash"
 * @returns True if the password matches, false otherwise
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const key = await getSecret('nextauth_secret', 'NEXTAUTH_SECRET');
  if (!key) {
    throw new Error('Failed to retrieve the encryption key from the secret provider');
  }

  const iterations = Number(process.env.ITERATIONS) || 10000;
  const keyLength = Number(process.env.KEY_LENGTH) || 64;
  const digest = process.env.ALGORITHM || 'sha512';

  if (!password || !storedHash) {
    return false;
  }

  try {
    const [salt, originalHash] = storedHash.split(':');
    if (!salt || !originalHash) return false;

    const hash = await pbkdf2Hex(password, key + salt, iterations, keyLength, digest);
    return hash === originalHash;
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Error during password verification');
    }
    return false;
  }
}

/**
 * Generate a secure random password
 * @param length - The length of the password (default: 16)
 * @returns A secure random password
 */
export function generateSecurePassword(length: number = 16): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  const buf = new Uint8Array(length);
  globalThis.crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[buf[i] % chars.length];
  }
  return out;
}
