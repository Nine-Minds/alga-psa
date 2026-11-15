/**
 * The one sign-in email normalization. Writers store trimmed, lowercased
 * addresses, so every lookup and every attempt key must normalize the same way
 * or a pasted " user@example.com " misses a valid account.
 */
export function normalizeLoginEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}
