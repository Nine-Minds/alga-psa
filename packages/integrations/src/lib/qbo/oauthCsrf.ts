import crypto from 'crypto';

// Cookie contract shared by the QBO OAuth connect and callback routes.
// The connect route sets the CSRF token in an HttpOnly cookie scoped to the
// callback path; the callback verifies it against the csrf value embedded in
// the OAuth state parameter (double-submit pattern), binding the callback to
// the browser session that initiated the flow.
export const QBO_OAUTH_CSRF_COOKIE_NAME = 'alga_qbo_oauth_csrf';
export const QBO_OAUTH_CSRF_COOKIE_PATH = '/api/integrations/qbo/callback';
export const QBO_OAUTH_CSRF_TTL_SECONDS = 600;

export function generateQboOauthCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function qboOauthCsrfTokensMatch(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'utf-8');
  const providedBuffer = Buffer.from(provided, 'utf-8');
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}
