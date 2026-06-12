import type { OauthCsrfCookieConfig } from '../oauth/oauthCsrf';

// Cookie contract shared by the Xero OAuth connect and callback routes.
// See ../oauth/oauthCsrf for the double-submit pattern these implement.
export const XERO_OAUTH_CSRF_COOKIE: OauthCsrfCookieConfig = {
  name: 'alga_xero_oauth_csrf',
  path: '/api/integrations/xero/callback',
  ttlSeconds: 600,
};
