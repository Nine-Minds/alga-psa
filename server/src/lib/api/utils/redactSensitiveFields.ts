const SENSITIVE_KEY_PATTERN =
  /^(hashed_password|password|two_factor_secret|mfa_secret|totp_secret|recovery_codes|backup_codes|password_reset_token|reset_token|verification_token|api_key|api_key_hash)$/i;

const MAX_REDACTION_DEPTH = 8;

export function redactSensitiveFields<T>(value: T, depth = 0, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value as object) || depth >= MAX_REDACTION_DEPTH) {
    return '[REDACTED]' as T;
  }

  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveFields(item, depth + 1, seen)) as T;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
    redacted[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? '[REDACTED]'
      : redactSensitiveFields(childValue, depth + 1, seen);
  }

  return redacted as T;
}
