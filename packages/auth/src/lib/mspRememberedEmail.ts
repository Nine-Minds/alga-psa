export const MSP_REMEMBERED_EMAIL_COOKIE = 'msp_remembered_email';
export const MSP_PENDING_REMEMBER_CONTEXT_COOKIE = 'msp_pending_remember_context';
export const MSP_REMEMBERED_EMAIL_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
export const MSP_PENDING_REMEMBER_CONTEXT_MAX_AGE_SECONDS = 10 * 60;

export function normalizeRememberedEmail(value: string): string {
  return value.trim().toLowerCase();
}
