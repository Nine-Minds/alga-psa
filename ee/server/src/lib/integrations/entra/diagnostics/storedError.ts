import { redactText } from './redaction';

/** Decode nested Temporal/serialized errors without returning transport objects. */
export function decodeEntraStoredError(value: unknown, depth = 0): string | null {
  if (depth > 12 || value == null) return null;
  if (typeof value === 'string') {
    if (!value.trim()) return null;
    try {
      const decoded = JSON.parse(value);
      return decodeEntraStoredError(decoded, depth + 1);
    } catch {
      return redactText(value, true);
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const error = value as Record<string, unknown>;
  // Temporal wrapper messages are usually generic; the causal error carries
  // the useful Microsoft response. Bound depth handles corrupt/cyclic input.
  for (const key of ['cause', 'failure', 'error', 'error_description', 'errorMessage', 'message']) {
    const message = decodeEntraStoredError(error[key], depth + 1);
    if (message) return message;
  }
  return null;
}
