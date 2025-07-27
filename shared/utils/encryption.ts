import crypto from 'crypto';
import { getSecret } from '../core/getSecret.js';

/**
 * Hash a password using PBKDF2 with a random salt
 * @param password - The plain text password to hash
 * @returns A string in the format "salt:hash"
 */
export async function hashPassword(password: string): Promise<string> {
  const key = await getSecret('alga_auth_key', 'ALGA_AUTH_KEY', 'defaultKey');
  const saltBytes = Number(process.env.SALT_BYTES) || 12;
  const iterations = Number(process.env.ITERATIONS) || 10000;
  const keyLength = Number(process.env.KEY_LENGTH) || 64;
  const digest = process.env.ALGORITHM || 'sha512';

  const salt = crypto.randomBytes(saltBytes).toString('hex');
  const hash = crypto.pbkdf2Sync(password, key + salt, iterations, keyLength, digest).toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verify a password against a stored hash
 * @param password - The plain text password to verify
 * @param storedHash - The stored hash in the format "salt:hash"
 * @returns True if the password matches, false otherwise
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const key = await getSecret('alga_auth_key', 'ALGA_AUTH_KEY', 'defaultKey');
  const iterations = Number(process.env.ITERATIONS) || 10000;
  const keyLength = Number(process.env.KEY_LENGTH) || 64;
  const digest = process.env.ALGORITHM || 'sha512';

  if (!password || !storedHash) {
    return false;
  }

  try {
    const [salt, originalHash] = storedHash.split(':');

    if (!salt || !originalHash) {
      return false;
    }

    const hash = crypto.pbkdf2Sync(password, key + salt, iterations, keyLength, digest).toString('hex');
    return hash === originalHash;
  } catch (error) {
    console.error('Error during password verification:', error);
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
  return Array.from(
    { length }, 
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join('');
}