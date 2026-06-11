import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  createQboOAuthState,
  validateQboOAuthState,
  buildQboOAuthStateCookie,
  buildClearedQboOAuthStateCookie,
  QBO_OAUTH_STATE_COOKIE,
  QBO_OAUTH_STATE_MAX_AGE_SECONDS,
} from './qboOAuthState';

const TEST_SECRET = 'test-signing-secret-32-bytes-long!';
const TENANT_ID = 'tenant-abc-123';

describe('qboOAuthState', () => {
  describe('createQboOAuthState + validateQboOAuthState round-trip', () => {
    it('round-trip: validates successfully and returns payload with matching tenantId/csrf', () => {
      const { stateParam, cookieValue, payload } = createQboOAuthState({
        tenantId: TENANT_ID,
        secret: TEST_SECRET,
      });

      const result = validateQboOAuthState({
        stateParam,
        cookieValue,
        secret: TEST_SECRET,
        // Pin now to before expiry
        now: payload.issuedAt + 1,
      });

      expect(result).not.toBeNull();
      expect(result!.tenantId).toBe(TENANT_ID);
      expect(result!.csrf).toBe(payload.csrf);
      expect(result!.issuedAt).toBe(payload.issuedAt);
      expect(result!.expiresAt).toBe(payload.expiresAt);
      expect(result!.nonce).toBe(payload.nonce);
    });

    it('round-trip: custom ttlSeconds is reflected in payload', () => {
      const TTL = 120;
      const { payload } = createQboOAuthState({
        tenantId: TENANT_ID,
        secret: TEST_SECRET,
        ttlSeconds: TTL,
      });

      expect(payload.expiresAt - payload.issuedAt).toBe(TTL);
    });
  });

  describe('tampered inputs → null', () => {
    it('tampered cookie signature (flip a char in the signature segment) → null', () => {
      const { stateParam, cookieValue, payload } = createQboOAuthState({
        tenantId: TENANT_ID,
        secret: TEST_SECRET,
      });

      // The cookie is <payloadEncoded>.<signature>; flip a char in the signature part
      const dotIndex = cookieValue.lastIndexOf('.');
      const sigPart = cookieValue.slice(dotIndex + 1);
      const tamperedSig =
        sigPart[0] === 'A'
          ? 'B' + sigPart.slice(1)
          : 'A' + sigPart.slice(1);
      const tamperedCookie = cookieValue.slice(0, dotIndex + 1) + tamperedSig;

      const result = validateQboOAuthState({
        stateParam,
        cookieValue: tamperedCookie,
        secret: TEST_SECRET,
        now: payload.issuedAt + 1,
      });

      expect(result).toBeNull();
    });

    it('mismatched stateParam from a different create call (csrf mismatch) → null', () => {
      const first = createQboOAuthState({ tenantId: TENANT_ID, secret: TEST_SECRET });
      const second = createQboOAuthState({ tenantId: TENANT_ID, secret: TEST_SECRET });

      // Pair first cookieValue with second stateParam — csrf values will not match
      const result = validateQboOAuthState({
        stateParam: second.stateParam,
        cookieValue: first.cookieValue,
        secret: TEST_SECRET,
        now: first.payload.issuedAt + 1,
      });

      expect(result).toBeNull();
    });

    it('wrong secret → null', () => {
      const { stateParam, cookieValue, payload } = createQboOAuthState({
        tenantId: TENANT_ID,
        secret: TEST_SECRET,
      });

      const result = validateQboOAuthState({
        stateParam,
        cookieValue,
        secret: 'wrong-secret',
        now: payload.issuedAt + 1,
      });

      expect(result).toBeNull();
    });

    it('expired: validate with now = payload.expiresAt + 1 → null', () => {
      const { stateParam, cookieValue, payload } = createQboOAuthState({
        tenantId: TENANT_ID,
        secret: TEST_SECRET,
      });

      const result = validateQboOAuthState({
        stateParam,
        cookieValue,
        secret: TEST_SECRET,
        now: payload.expiresAt + 1,
      });

      expect(result).toBeNull();
    });

    it('exactly at expiresAt boundary: now = payload.expiresAt → null (expiresAt <= now)', () => {
      const { stateParam, cookieValue, payload } = createQboOAuthState({
        tenantId: TENANT_ID,
        secret: TEST_SECRET,
      });

      const result = validateQboOAuthState({
        stateParam,
        cookieValue,
        secret: TEST_SECRET,
        now: payload.expiresAt,
      });

      expect(result).toBeNull();
    });
  });

  describe('missing inputs → null', () => {
    it('no cookieValue → null', () => {
      const { stateParam } = createQboOAuthState({ tenantId: TENANT_ID, secret: TEST_SECRET });

      expect(validateQboOAuthState({ stateParam, cookieValue: undefined, secret: TEST_SECRET })).toBeNull();
    });

    it('no stateParam → null', () => {
      const { cookieValue } = createQboOAuthState({ tenantId: TENANT_ID, secret: TEST_SECRET });

      expect(validateQboOAuthState({ stateParam: null, cookieValue, secret: TEST_SECRET })).toBeNull();
    });

    it('empty stateParam → null', () => {
      const { cookieValue } = createQboOAuthState({ tenantId: TENANT_ID, secret: TEST_SECRET });

      expect(validateQboOAuthState({ stateParam: '', cookieValue, secret: TEST_SECRET })).toBeNull();
    });

    it('no secret → null', () => {
      const { stateParam, cookieValue } = createQboOAuthState({ tenantId: TENANT_ID, secret: TEST_SECRET });

      expect(validateQboOAuthState({ stateParam, cookieValue, secret: undefined })).toBeNull();
    });

    it('empty secret → null', () => {
      const { stateParam, cookieValue } = createQboOAuthState({ tenantId: TENANT_ID, secret: TEST_SECRET });

      expect(validateQboOAuthState({ stateParam, cookieValue, secret: '' })).toBeNull();
    });

    it('cookie value without dot separator → null', () => {
      const { stateParam } = createQboOAuthState({ tenantId: TENANT_ID, secret: TEST_SECRET });

      expect(validateQboOAuthState({ stateParam, cookieValue: 'nodothere', secret: TEST_SECRET })).toBeNull();
    });
  });

  describe('buildQboOAuthStateCookie', () => {
    it('has correct properties for a live cookie', () => {
      const cookie = buildQboOAuthStateCookie('test-value');

      expect(cookie.name).toBe(QBO_OAUTH_STATE_COOKIE);
      expect(cookie.value).toBe('test-value');
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.sameSite).toBe('lax');
      expect(cookie.path).toBe('/api/integrations/qbo');
      expect(cookie.maxAge).toBe(QBO_OAUTH_STATE_MAX_AGE_SECONDS);
      expect(QBO_OAUTH_STATE_MAX_AGE_SECONDS).toBe(600);
    });
  });

  describe('buildClearedQboOAuthStateCookie', () => {
    it('clears the cookie by setting maxAge to 0 and empty value', () => {
      const cookie = buildClearedQboOAuthStateCookie();

      expect(cookie.name).toBe(QBO_OAUTH_STATE_COOKIE);
      expect(cookie.value).toBe('');
      expect(cookie.maxAge).toBe(0);
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.sameSite).toBe('lax');
      expect(cookie.path).toBe('/api/integrations/qbo');
    });
  });
});
