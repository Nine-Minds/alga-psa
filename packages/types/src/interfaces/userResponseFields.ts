import type { IUserWithRoles } from './auth.interfaces';

/** User columns that are safe to include in application responses. */
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
