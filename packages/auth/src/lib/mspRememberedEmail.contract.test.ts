import { describe, expect, it } from 'vitest';
import {
  MSP_PENDING_REMEMBER_CONTEXT_COOKIE,
  MSP_REMEMBERED_EMAIL_COOKIE,
} from './mspRememberedEmail';
import { getSessionCookieConfig } from './session';

describe('MSP remembered-email cookie contract', () => {
  it('T011: remembered-email cookies do not reuse the preferred-provider localStorage key or session cookie names', () => {
    expect(MSP_REMEMBERED_EMAIL_COOKIE).toBe('msp_remembered_email');
    expect(MSP_PENDING_REMEMBER_CONTEXT_COOKIE).toBe('msp_pending_remember_context');
    expect(MSP_REMEMBERED_EMAIL_COOKIE).not.toBe('msp_sso_last_provider');
    expect(MSP_PENDING_REMEMBER_CONTEXT_COOKIE).not.toBe('msp_sso_last_provider');
    expect(MSP_REMEMBERED_EMAIL_COOKIE).not.toBe(getSessionCookieConfig().name);
    expect(MSP_PENDING_REMEMBER_CONTEXT_COOKIE).not.toBe(getSessionCookieConfig().name);
  });
});
