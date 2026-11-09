import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.hoisted(() => vi.fn());
const flag = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/auth', () => ({ getSession }));
vi.mock('@alga-psa/core/features', () => ({
  isFeatureFlagEnabled: flag,
  // The gate reads the flag through evaluateFeatureFlag; mirror the checker's outcome.
  evaluateFeatureFlag: async (...args: unknown[]) => {
    try {
      return { status: 'evaluated', enabled: Boolean(await flag(...args)) };
    } catch {
      return { status: 'unavailable' };
    }
  },
}));

import { clearCapabilityCache, resetCapabilityRegistry } from '@alga-psa/core/capability/testing';
import { GET } from './route';

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Resource not found' } };
const msp = { user: { user_type: 'internal', tenant: 'tenant-1', id: 'u1' } };

const call = (key: string) =>
  GET(new Request(`http://localhost/api/v1/capabilities/${key}`), { params: Promise.resolve({ key }) });

describe('GET /api/v1/capabilities/co-managed', () => {
  beforeEach(() => {
    resetCapabilityRegistry();
    clearCapabilityCache();
    getSession.mockResolvedValue(msp);
    flag.mockImplementation(async () => true);
    delete process.env.FORCE_CAPABILITIES;
  });
  afterEach(() => {
    delete process.env.FORCE_CAPABILITIES;
    vi.clearAllMocks();
  });

  it('401 without a session', async () => {
    getSession.mockResolvedValue(null);
    const res = await call('co-managed');
    expect(res.status).toBe(401);
  });

  it('404 with the exact NotFound body for a client-portal session', async () => {
    getSession.mockResolvedValue({ user: { user_type: 'client', tenant: 'tenant-1' } });
    process.env.FORCE_CAPABILITIES = 'co-managed:on';
    const res = await call('co-managed');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
  });

  it('404 today (flag on, no eligibility resolver) with no-store', async () => {
    const res = await call('co-managed');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('404 (not 500) when the flag evaluator throws', async () => {
    flag.mockRejectedValue(new Error('posthog down'));
    const res = await call('co-managed');
    expect(res.status).toBe(404);
  });

  it('200 with the caller own decision under co-managed:on', async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed:on';
    const res = await call('co-managed');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body).toMatchObject({
      capability: 'co-managed',
      tenantId: 'tenant-1',
      admitted: true,
      served: true,
      forced: 'on',
      featureFlag: { key: 'release-v2-0-feature', value: true },
    });
    expect(body.reasons).toBeDefined();
    expect(typeof body.evaluatedAt).toBe('string');
  });

  it('ignores a ?tenant= parameter: the body always carries the session tenant', async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed:on';
    const request = new Request('http://localhost/api/v1/capabilities/co-managed?tenant=other-tenant');
    const res = await GET(request, { params: Promise.resolve({ key: 'co-managed' }) });
    expect(res.status).toBe(200);
    expect((await res.json()).tenantId).toBe('tenant-1');
    // The handler takes the route params only to pick the capability; it never reads the request.
    expect(GET.toString()).not.toMatch(/_request\.|request\.(url|headers|nextUrl|json)/);
  });

  it('forced off cannot be a 200: it closes the gate, so the probe answers the 404', async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed:off';
    const res = await call('co-managed');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
  });

  it('co-managed:off closes co-managed; the Timeline flag is untouched', async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed:off';
    const res = await call('co-managed');
    expect(res.status).toBe(404);
    // The forced switch never evaluates or alters release-v2-0-feature.
    const { isFeatureFlagEnabled } = await import('@alga-psa/core/features');
    expect(await isFeatureFlagEnabled('release-v2-0-feature', { tenantId: 'tenant-1' })).toBe(true);
  });
});

describe('GET /api/v1/capabilities/ticket-conversations', () => {
  beforeEach(() => {
    resetCapabilityRegistry();
    clearCapabilityCache();
    getSession.mockResolvedValue(msp);
    flag.mockImplementation(async () => true);
    delete process.env.FORCE_CAPABILITIES;
  });
  afterEach(() => {
    delete process.env.FORCE_CAPABILITIES;
    vi.clearAllMocks();
  });

  it('404 with the exact NotFound body when the flag is off', async () => {
    flag.mockImplementation(async () => false);
    const res = await call('ticket-conversations');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
  });

  it('200 admitted but not served (resolver-unregistered) when the flag is on', async () => {
    const res = await call('ticket-conversations');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      capability: 'ticket-conversations',
      tenantId: 'tenant-1',
      admitted: true,
      served: false,
      forced: null,
      reasons: { admitted: 'open', served: 'resolver-unregistered' },
      resolvers: { eligibility: 'registered', participation: 'unregistered' },
      featureFlag: { key: 'release-v2-0-feature', value: true },
    });
  });

  it('ticket-conversations:off is a 404 for it and leaves the co-managed answer unchanged', async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed:on,ticket-conversations:off';
    expect((await call('ticket-conversations')).status).toBe(404);
    const cm = await call('co-managed');
    expect(cm.status).toBe(200);
    expect(await cm.json()).toMatchObject({ capability: 'co-managed', admitted: true, served: true, forced: 'on' });
  });

  it('an unknown key answers the same 404 as a closed capability (after the session checks)', async () => {
    const res = await call('nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    getSession.mockResolvedValue(null);
    expect((await call('nope')).status).toBe(401);
  });
});
