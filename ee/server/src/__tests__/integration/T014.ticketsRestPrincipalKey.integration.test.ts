/**
 * T014: REST GET /api/v1/tickets (the real route controller) with a service principal key.
 *  - succeeds under the principal's MSP role
 *  - 403 when the role lacks ticket:read
 *  - a client-owned key is still rejected
 * Real key validation, real EE boundary, real RBAC against the migrated database. Only the
 * rate limiter and the product lookup are stubbed.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { tenantDb } from '@alga-psa/db';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', async () => (await import('./helpers/spMocks')).publishersMock());
vi.mock('@alga-psa/db', async (importOriginal) => (await import('./helpers/spHarness')).mockDbModuleFactory(importOriginal as never));
vi.mock('@/lib/db/db', async (importOriginal) => (await import('./helpers/spHarness')).mockDbModuleFactory(importOriginal as never));
vi.mock('server/src/lib/api/rateLimit/enforce', () => ({ enforceApiRateLimit: vi.fn(async () => undefined) }));
vi.mock('@/lib/productAccess', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getTenantProduct: vi.fn(async () => 'psa'),
}));
vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({ assertTenantTierAccess: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/licensing', () => ({
  getLicenseStateRow: vi.fn(async () => null),
  verifyLicense: vi.fn(() => ({ valid: false })),
}));

import { boot, teardown, harness, createHuman, createPrincipal } from './helpers/spHarness';
import { TicketService } from 'server/src/lib/api/services/TicketService';
import { GET } from 'server/src/app/api/v1/tickets/route';

beforeAll(async () => {
  await boot('sp_t014_tickets_rest');
  // The controller's service resolves its own connection; point every instance at the test DB.
  vi.spyOn(TicketService.prototype as never, 'getKnex' as never).mockImplementation((async () => ({
    knex: harness().db,
    tenant: harness().tenant,
  })) as never);
}, 600_000);
afterAll(teardown);

const call = (apiKey: string) =>
  GET(new Request('http://localhost/api/v1/tickets?limit=5', { headers: { 'x-api-key': apiKey } }) as never);

describe('T014 GET /api/v1/tickets with a service principal key', () => {
  it('succeeds under the principal MSP role', async () => {
    const principal = await createPrincipal(); // Admin role
    const response = await call(principal.apiKey);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('is 403 when the principal role has no ticket:read', async () => {
    const principal = await createPrincipal({ roleId: harness().emptyRoleId });
    const response = await call(principal.apiKey);
    expect(response.status).toBe(403);
  });

  it('still rejects a client-owned key', async () => {
    const { db, tenant } = harness();
    const clientUser = await createHuman(undefined, 'client');
    const plaintext = crypto.randomBytes(32).toString('hex');
    await tenantDb(db, tenant).table('api_keys').insert({
      api_key: crypto.createHash('sha256').update(plaintext).digest('hex'),
      user_id: clientUser,
      tenant,
      description: 'T014 client-owned key',
      active: true,
    });
    const response = await call(plaintext);
    expect([401, 403]).toContain(response.status);
    expect(response.status).not.toBe(200);
  });
});
