import type { OauthCsrfCookieConfig } from '../oauth/oauthCsrf';

// Cookie contract shared by the Xero OAuth connect and callback routes.
// See ../oauth/oauthCsrf for the double-submit pattern these implement.
//
// The path spans both routes so the connect route can see (and reuse) a
// token from a previous attempt in the same browser. Reuse is what lets two
// parallel tabs both complete: the cookie is a single browser slot, so each
// connect reuses the well-formed token already in it rather than clobbering
// a parallel attempt's binding. The cookie is left in place until its TTL
// rather than cleared on the first callback, for the same reason.
export const XERO_OAUTH_CSRF_COOKIE: OauthCsrfCookieConfig = {
  name: 'alga_xero_oauth_csrf',
  path: '/api/integrations/xero',
  ttlSeconds: 600,
};
