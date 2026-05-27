const SENSITIVE_KEY_PATTERN =
  /^(hashed_password|hashedPassword|password_hash|passwordHash|password|two_factor_secret|twoFactorSecret|mfa_secret|mfaSecret|totp_secret|totpSecret|recovery_codes|recoveryCodes|backup_codes|backupCodes|password_reset_token|passwordResetToken|reset_token|resetToken|verification_token|verificationToken|api_key|apiKey|api_key_hash|apiKeyHash)$/i;

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
