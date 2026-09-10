import {
  base32Decode,
  counterBytes,
  counterFor,
  dynamicTruncate,
  secondsRemaining,
  type TotpResult,
} from './totpCore';

export async function generateTotpInBrowser(
  secret: string,
  timestampMs: number = Date.now()
): Promise<TotpResult> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is unavailable for TOTP generation.');
  }
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    base32Decode(secret) as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const signature = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    counterBytes(counterFor(timestampMs)) as unknown as BufferSource
  );
  const hash = new Uint8Array(signature);
  return {
    code: dynamicTruncate(hash),
    secondsRemaining: secondsRemaining(timestampMs),
  };
}
