import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  matchEndpoint,
  filterRequestHeaders,
  filterResponseHeaders,
  getTimeoutMs,
  pathnameFromParts,
  type ApiEndpointDef,
  type Method,
} from '../../lib/gateway-utils';

describe('gateway-utils', () => {
  describe('pathnameFromParts()', () => {
    it('joins parts with a leading slash', () => {
      expect(pathnameFromParts(['agreements', '123'])).toBe('/agreements/123');
      expect(pathnameFromParts([])).toBe('/');
      expect(pathnameFromParts([''])).toBe('/');
      expect(pathnameFromParts(['agreements', '', 'sync'])).toBe('/agreements/sync');
    });
  });

  describe('matchEndpoint()', () => {
    const endpoints: ApiEndpointDef[] = [
      { method: 'GET', path: '/agreements', handler: 'dist/handlers/http/list-agreements' },
      { method: 'GET', path: '/agreements/:id', handler: 'dist/handlers/http/get-agreement' },
      { method: 'POST', path: '/agreements/sync', handler: 'dist/handlers/http/sync' },
      { method: 'PUT', path: '/agreements/:id', handler: 'dist/handlers/http/update-agreement' },
      { method: 'DELETE', path: '/agreements/:id', handler: 'dist/handlers/http/delete-agreement' },
      { method: 'PATCH', path: '/agreements/:id/status', handler: 'dist/handlers/http/patch-status' },
    ];

    it('matches literal path and method', () => {
      const res = matchEndpoint(endpoints, 'GET', '/agreements');
      expect(res).toEqual({ handler: 'dist/handlers/http/list-agreements' });
    });

    it('matches parameterized segment with same length', () => {
      const res = matchEndpoint(endpoints, 'GET', '/agreements/abc-123');
      expect(res).toEqual({ handler: 'dist/handlers/http/get-agreement' });
    });

    it('does not match wrong method', () => {
      const res = matchEndpoint(endpoints, 'POST', '/agreements/abc-123');
      expect(res).toBeNull();
    });

    it('does not match when segment counts differ', () => {
      expect(matchEndpoint(endpoints, 'GET', '/agreements/abc/extra')).toBeNull();
      expect(matchEndpoint(endpoints, 'GET', '/')).toBeNull();
    });

    it('matches nested param and literal endings', () => {
      const res = matchEndpoint(endpoints, 'PATCH', '/agreements/abc-123/status');
      expect(res).toEqual({ handler: 'dist/handlers/http/patch-status' });
    });
  });

  describe('filterRequestHeaders()', () => {
    function buildHeaders(h: Record<string, string>) {
      return new Headers(h);
    }
    const tenantId = 'tenant-1';
    const extensionId = 'com.alga.test';
    const requestId = 'req-123';

    it('allows only allowlisted headers and strips authorization', () => {
      const headers = buildHeaders({
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': 'Bearer end-user-token',
        'User-Agent': 'jest',
        'X-Idempotency-Key': 'client-provided',
        'x-random': 'should-drop',
      });
      const out = filterRequestHeaders(headers, tenantId, extensionId, requestId, 'GET');
      expect(out['accept']).toBe('application/json');
      expect(out['content-type']).toBe('application/json');
      expect(out['user-agent']).toBe('jest');
      expect(out['authorization']).toBeUndefined();
      // injected
      expect(out['x-request-id']).toBe(requestId);
      expect(out['x-alga-tenant']).toBe(tenantId);
      expect(out['x-alga-extension']).toBe(extensionId);
      // For GET, should not force idempotency if not provided
      expect(out['x-idempotency-key']).toBe('client-provided');
    });

    it('injects idempotency key for non-GET when missing', () => {
      const headers = buildHeaders({
        'Accept': 'application/json',
      });
      const out = filterRequestHeaders(headers, tenantId, extensionId, requestId, 'POST');
      expect(out['x-idempotency-key']).toBeDefined();
      expect(out['x-idempotency-key'].length).toBeGreaterThan(0);
    });
  });

  describe('filterResponseHeaders()', () => {
    it('returns only allowlisted response headers and normalizes arrays', () => {
      const out = filterResponseHeaders({
        'Content-Type': 'application/json',
        'Cache-Control': ['max-age=0', 'no-store'],
        'Set-Cookie': 'should-not-pass',
        'X-Ext-Warning': 'heads-up',
        'X-Other': 'drop',
      });
      expect(out['content-type']).toBe('application/json');
      expect(out['cache-control']).toBe('max-age=0, no-store');
      expect(out['x-ext-warning']).toBe('heads-up');
      expect(out['set-cookie']).toBeUndefined();
      expect(out['x-other']).toBeUndefined();
    });

    it('handles undefined input', () => {
      const out = filterResponseHeaders(undefined);
      expect(out).toEqual({});
    });
  });

  describe('getTimeoutMs()', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
      process.env = { ...OLD_ENV };
    });

    afterEach(() => {
      process.env = OLD_ENV;
    });

    it('returns default 5000 when unset', () => {
      delete process.env.EXT_GATEWAY_TIMEOUT_MS;
      expect(getTimeoutMs()).toBe(5000);
    });

    it('parses valid numeric env', () => {
      process.env.EXT_GATEWAY_TIMEOUT_MS = '12000';
      expect(getTimeoutMs()).toBe(12000);
    });

    it('falls back to default on invalid values', () => {
      process.env.EXT_GATEWAY_TIMEOUT_MS = 'abc';
      expect(getTimeoutMs()).toBe(5000);
      process.env.EXT_GATEWAY_TIMEOUT_MS = '-5';
      expect(getTimeoutMs()).toBe(5000);
    });
  });
});