import type { IRole, IUserWithRoles } from '@alga-psa/types';
import { USER_RESPONSE_FIELD_NAMES, type AllowlistedUserField } from '@alga-psa/types';

export { USER_RESPONSE_FIELD_NAMES };
export type { AllowlistedUserField };

export const USER_RESPONSE_COLUMNS: string[] = USER_RESPONSE_FIELD_NAMES.map(
  (column) => `users.${column}`
);

export const API_USER_CONTEXT_COLUMNS: AllowlistedUserField[] = [...USER_RESPONSE_FIELD_NAMES];

export const SENSITIVE_USER_FIELDS = [
  'hashed_password',
  'password',
  'two_factor_secret',
  'mfa_secret',
  'totp_secret',
  'recovery_codes',
  'backup_codes',
  'password_reset_token',
  'reset_token',
  'verification_token',
  'api_key',
  'api_key_hash'
] as const;

type SensitiveUserField = typeof SENSITIVE_USER_FIELDS[number];

export type SafeApiUser = Pick<IUserWithRoles, AllowlistedUserField> & {
  roles: IRole[];
  avatarUrl?: string | null;
  clientId?: string;
};

export function sanitizeUserForResponse<T extends Record<string, any>>(
  user: T
): SafeApiUser {
  const sanitized: Record<string, any> = { roles: [] };

  for (const field of USER_RESPONSE_FIELD_NAMES) {
    if (field in user) {
      sanitized[field] = user[field];
    }
  }

  if ('roles' in user && Array.isArray(user.roles)) {
    sanitized.roles = user.roles;
  }

  if ('avatarUrl' in user) {
    sanitized.avatarUrl = user.avatarUrl;
  }

  if ('clientId' in user) {
    sanitized.clientId = user.clientId;
  }

  return sanitized as SafeApiUser;
}

export type { SensitiveUserField };
