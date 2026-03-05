export const MSP_REMEMBERED_EMAIL_COOKIE = 'msp_remembered_email';
export const MSP_PENDING_REMEMBER_CONTEXT_COOKIE = 'msp_pending_remember_context';
export const MSP_REMEMBERED_EMAIL_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
export const MSP_PENDING_REMEMBER_CONTEXT_MAX_AGE_SECONDS = 10 * 60;
const REMEMBERED_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeRememberedEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidRememberedEmail(value: string): boolean {
  return REMEMBERED_EMAIL_PATTERN.test(value);
}

export function buildRememberedEmailCookie(email: string) {
  return {
    name: MSP_REMEMBERED_EMAIL_COOKIE,
    value: email,
    path: '/',
    maxAge: MSP_REMEMBERED_EMAIL_MAX_AGE_SECONDS,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  };
}

export function buildClearedRememberedEmailCookie() {
  return {
    name: MSP_REMEMBERED_EMAIL_COOKIE,
    value: '',
    path: '/',
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  };
}
