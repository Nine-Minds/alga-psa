/**
 * Name of the signed, HTTP-only cookie that carries a profile SSO *link*
 * authorization from the re-auth step to the OAuth callback.
 *
 * Its presence is also the only way a request can tell a link attempt apart
 * from a plain sign-in, which the sign-in error page needs in order to send a
 * failed link back to the profile tab that started it.
 */
export const SSO_LINK_STATE_COOKIE = 'sso-link-state';

/** Canonical URL of the profile tab that owns SSO linking. */
export const SSO_PROFILE_TAB_URL = '/msp/profile?tab=single-sign-on';
