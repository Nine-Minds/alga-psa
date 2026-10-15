/**
 * Retain four characters and the length for operator comparison. Email keeps
 * its existing prefix contract; callers may request a suffix for client secrets.
 */
export function buildTokenFingerprint(token?: string | null, edge: 'start' | 'end' = 'start'): string | undefined {
  if (!token) return undefined;
  return `${edge === 'end' ? token.slice(-4) : token.slice(0, 4)}...(${token.length})`;
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
