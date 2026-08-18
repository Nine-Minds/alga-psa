export const TACTICAL_WEBHOOK_HEADER_NAME = 'X-Alga-Webhook-Secret' as const;

// Tenant-secret names. Here rather than in the actions module so non-action
// callers (the scheduled device sync engine) can build a client without
// importing a 'use server' file.
export const TACTICAL_INSTANCE_URL_SECRET = 'tacticalrmm_instance_url';
export const TACTICAL_API_KEY_SECRET = 'tacticalrmm_api_key';
export const TACTICAL_KNOX_USERNAME_SECRET = 'tacticalrmm_username';
export const TACTICAL_KNOX_PASSWORD_SECRET = 'tacticalrmm_password';
export const TACTICAL_KNOX_TOKEN_SECRET = 'tacticalrmm_knox_token';
export const TACTICAL_WEBHOOK_SECRET = 'tacticalrmm_webhook_secret';

export type { TacticalRmmAuthMode } from './tacticalApiClient';
