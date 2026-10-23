// Unmatched inbound email has neither user nor contact; the sender recorded in metadata names it.
export function inboundSenderLabel(metadata: unknown): string | null {
  const email = (metadata as { email?: unknown } | null)?.email;
  if (!email || typeof email !== 'object' || Array.isArray(email)) return null;
  const { fromName, fromAddress, from } = email as Record<string, unknown>;
  const fromObj = from && typeof from === 'object' && !Array.isArray(from) ? (from as Record<string, unknown>) : null;
  for (const value of [fromName, fromObj?.name, fromAddress, fromObj?.email]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}
