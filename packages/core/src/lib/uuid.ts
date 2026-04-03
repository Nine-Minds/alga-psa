/**
 * Generate a UUID v4, with a fallback for non-secure browser contexts (plain HTTP).
 *
 * `crypto.randomUUID()` is only available in secure contexts (HTTPS or localhost)
 * in browsers. This helper falls back to `crypto.getRandomValues()` which works
 * in all contexts and still provides cryptographic randomness.
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback using crypto.getRandomValues (available in all browser contexts)
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => {
    const n = Number(c);
    return (n ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (n / 4)))).toString(16);
  });
}
