import { readFileSync } from 'node:fs';
import { createVerify } from 'node:crypto';

/**
 * Loads a PEM trust bundle from SIGNING_TRUST_BUNDLE path and returns raw contents.
 */
export function loadTrustBundleFromEnv(): string | null {
  const p = process.env.SIGNING_TRUST_BUNDLE;
  if (!p) return null;
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Verifies a detached signature using a single PEM public key.
 * Note: Real implementation likely requires CMS/PKCS#7 or a chain; this is a placeholder
 * verifying raw bytes with a chosen algorithm against a public key.
 */
export function verifyDetachedSignature(
  content: Buffer,
  signature: Buffer,
  publicKeyPem: string,
  algorithm: 'sha256' | 'sha384' | 'sha512' = 'sha256'
): boolean {
  const v = createVerify(algorithm);
  v.update(content);
  v.end();
  try {
    return v.verify(publicKeyPem, signature);
  } catch {
    return false;
  }
}

