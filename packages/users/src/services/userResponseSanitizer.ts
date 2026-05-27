export const USER_RESPONSE_COLUMNS = [
  'users.user_id',
  'users.username',
  'users.first_name',
  'users.last_name',
  'users.email',
  'users.phone',
  'users.timezone',
  'users.user_type',
  'users.contact_id',
  'users.image',
  'users.created_at',
  'users.updated_at',
  'users.two_factor_enabled',
  'users.two_factor_required_new_device',
  'users.is_google_user',
  'users.is_inactive',
  'users.tenant',
  'users.reports_to',
  'users.last_login_at',
  'users.last_login_method'
];

export const SENSITIVE_USER_FIELDS = [
  'hashed_password',
  'password',
  'two_factor_secret'
];

export function sanitizeUserForResponse<T extends Record<string, any>>(
  user: T
): Omit<T, 'hashed_password' | 'password' | 'two_factor_secret'> {
  const sanitized = { ...user };

  for (const field of SENSITIVE_USER_FIELDS) {
    delete sanitized[field];
  }

  return sanitized;
}
