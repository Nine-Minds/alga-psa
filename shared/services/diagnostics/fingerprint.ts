/**
 * Produce a safe, non-reversible fingerprint of a credential. The first four
 * characters are retained so an operator can match without exposing the value.
 */
export function buildTokenFingerprint(token?: string | null): string | undefined {
  if (!token) return undefined;
  return `${token.slice(0, 4)}...(${token.length})`;
}

/**
 * Decode a JWT payload without verifying its signature. Intended only for
 * diagnostics; callers must treat the claims as untrusted display data.
 */
export function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1];
    const padded = payload
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}
