/**
 * User-row response allow-list.
 *
 * Lives in @alga-psa/types (not @alga-psa/users) so every feature package that
 * returns `users` rows (e.g. @alga-psa/tickets) can use it without depending on
 * @alga-psa/users, which itself depends on those packages. @alga-psa/users
 * re-exports this module for existing importers.
 */
import type { IRole, IUserWithRoles } from '../interfaces';

const USER_RESPONSE_FIELD_NAMES_TUPLE = [
  'user_id',
  'username',
  'first_name',
  'last_name',
  'email',
  'phone',
  'timezone',
  'user_type',
  'contact_id',
  'icon',
  'created_at',
  'updated_at',
  'two_factor_enabled',
  'two_factor_required_new_device',
  'is_google_user',
  'is_inactive',
  'tenant',
  'reports_to',
  'last_login_at',
  'last_login_method'
] as const satisfies readonly (keyof IUserWithRoles)[];

export type AllowlistedUserField = (typeof USER_RESPONSE_FIELD_NAMES_TUPLE)[number];

export const USER_RESPONSE_FIELD_NAMES: AllowlistedUserField[] = [...USER_RESPONSE_FIELD_NAMES_TUPLE];

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
