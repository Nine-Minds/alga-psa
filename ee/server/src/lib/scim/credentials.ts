import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { Buffer } from 'node:buffer';

const TOKEN_PREFIX = 'alga_scim_';
const SCRYPT_KEY_LENGTH = 32;

export interface GeneratedScimToken {
  plaintext: string;
  hash: string;
}

export function hashScimToken(token: string, salt = randomBytes(16)): string {
  const digest = scryptSync(token, salt, SCRYPT_KEY_LENGTH);
  return `scrypt$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

export function generateScimToken(): GeneratedScimToken {
  const plaintext = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return {
    plaintext,
    hash: hashScimToken(plaintext),
  };
}

export function verifyScimToken(token: string, encodedHash: string | null | undefined): boolean {
  if (!encodedHash) {
    // Perform comparable work for missing hashes so connection state is not
    // exposed through a trivial timing difference.
    scryptSync(token, Buffer.alloc(16), SCRYPT_KEY_LENGTH);
    return false;
  }

  const [algorithm, encodedSalt, encodedDigest] = encodedHash.split('$');
  if (algorithm !== 'scrypt' || !encodedSalt || !encodedDigest) {
    scryptSync(token, Buffer.alloc(16), SCRYPT_KEY_LENGTH);
    return false;
  }

  try {
    const expected = Buffer.from(encodedDigest, 'base64url');
    const actual = scryptSync(
      token,
      Buffer.from(encodedSalt, 'base64url'),
      expected.length
    );
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    scryptSync(token, Buffer.alloc(16), SCRYPT_KEY_LENGTH);
    return false;
  }
}
