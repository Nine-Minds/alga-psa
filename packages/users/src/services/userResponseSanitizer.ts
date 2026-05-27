import type { IUserWithRoles } from '@alga-psa/types';

export const USER_RESPONSE_FIELD_NAMES = [
  'user_id',
  'username',
  'first_name',
  'last_name',
  'email',
  'phone',
  'timezone',
  'user_type',
  'contact_id',
  'image',
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
];

export const USER_RESPONSE_COLUMNS = USER_RESPONSE_FIELD_NAMES.map((column) => `users.${column}`);

export const SENSITIVE_USER_FIELDS = [
  'hashed_password',
  'password',
  'two_factor_secret'
] as const;

type SensitiveUserField = typeof SENSITIVE_USER_FIELDS[number];

export type SafeApiUser = Omit<IUserWithRoles, SensitiveUserField> & {
  avatarUrl?: string | null;
};

export function sanitizeUserForResponse<T extends Record<string, any>>(
  user: T
): Partial<Omit<T, SensitiveUserField>> {
  const sanitized: Record<string, any> = {};

  for (const field of USER_RESPONSE_FIELD_NAMES) {
    if (field in user) {
      sanitized[field] = user[field];
    }
  }

  if ('roles' in user) {
    sanitized.roles = user.roles;
  }

  if ('avatarUrl' in user) {
    sanitized.avatarUrl = user.avatarUrl;
  }

  if ('clientId' in user) {
    sanitized.clientId = user.clientId;
  }

  return sanitized as Partial<Omit<T, SensitiveUserField>>;
}
