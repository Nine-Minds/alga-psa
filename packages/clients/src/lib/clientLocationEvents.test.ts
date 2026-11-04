import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks: Array<() => Promise<unknown>> = [];
const publish = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@alga-psa/db', () => ({
  registerAfterCommit: (_trx: unknown, fn: () => Promise<unknown>) => {
    hooks.push(fn);
  },
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: publish }));

import {
  queueClientLocationCreated,
  queueClientLocationDeleted,
  queueClientLocationUpdated,
} from './clientLocationEvents';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LOC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const trx = {} as any;

const loc = (over: Record<string, unknown> = {}) =>
  ({
    location_id: LOC,
    client_id: CLIENT,
    tenant: TENANT,
    location_name: 'HQ',
    address_line1: '1 Main St',
    city: 'Town',
    country_code: 'US',
    country_name: 'United States',
    is_default: false,
    is_active: true,
    ...over,
  }) as any;

async function flush() {
  const pending = hooks.splice(0);
  for (const h of pending) await h();
}
const published = () => publish.mock.calls.map((c: any[]) => c[0]);

beforeEach(() => {
  hooks.length = 0;
  publish.mockClear();
});

describe('client location domain events', () => {
  it('created: nothing is published before commit, one CLIENT_LOCATION_CREATED after', async () => {
    queueClientLocationCreated(trx, TENANT, loc({ is_default: true }), { actorUserId: 'u1' });
    expect(publish).not.toHaveBeenCalled();
    await flush();
    const [evt] = published();
    expect(published()).toHaveLength(1);
    expect(evt.eventType).toBe('CLIENT_LOCATION_CREATED');
    expect(evt.payload).toMatchObject({ locationId: LOC, clientId: CLIENT, isDefault: true, createdByUserId: 'u1' });
    expect(evt.ctx).toMatchObject({ tenantId: TENANT, actor: { actorType: 'USER', actorUserId: 'u1' } });
  });

  it('created by a system writer has no actor', async () => {
    queueClientLocationCreated(trx, TENANT, loc());
    await flush();
    expect(published()[0].ctx.actor).toBeUndefined();
  });

  it('a rolled-back transaction (hooks never flushed) publishes nothing', () => {
    queueClientLocationCreated(trx, TENANT, loc());
    queueClientLocationUpdated(trx, TENANT, loc(), loc({ city: 'Other' }));
    queueClientLocationDeleted(trx, TENANT, loc());
    hooks.length = 0; // rollback discards registered hooks
    expect(publish).not.toHaveBeenCalled();
  });

  it('updated: publishes CLIENT_LOCATION_UPDATED with changed field names', async () => {
    queueClientLocationUpdated(trx, TENANT, loc(), loc({ city: 'Other', address_line1: '2 Side St' }));
    await flush();
    expect(published().map((e) => e.eventType)).toEqual(['CLIENT_LOCATION_UPDATED']);
    expect(published()[0].payload.updatedFields.length).toBeGreaterThan(0);
  });

  it('updated with no real change publishes nothing', async () => {
    queueClientLocationUpdated(trx, TENANT, loc(), loc());
    await flush();
    expect(publish).not.toHaveBeenCalled();
  });

  it('active -> inactive publishes UPDATED and DEACTIVATED', async () => {
    queueClientLocationUpdated(trx, TENANT, loc(), loc({ is_active: false }));
    await flush();
    expect(published().map((e) => e.eventType).sort()).toEqual(['CLIENT_LOCATION_DEACTIVATED', 'CLIENT_LOCATION_UPDATED']);
  });

  it('inactive -> active is reported as UPDATED only (no reverse domain event)', async () => {
    queueClientLocationUpdated(trx, TENANT, loc({ is_active: false }), loc({ is_active: true }));
    await flush();
    expect(published().map((e) => e.eventType)).toEqual(['CLIENT_LOCATION_UPDATED']);
  });

  it('already-inactive row edited does not re-emit DEACTIVATED', async () => {
    queueClientLocationUpdated(trx, TENANT, loc({ is_active: false }), loc({ is_active: false, city: 'Z' }));
    await flush();
    expect(published().map((e) => e.eventType)).toEqual(['CLIENT_LOCATION_UPDATED']);
  });

  it('deleted: publishes CLIENT_LOCATION_DELETED with location and client ids', async () => {
    queueClientLocationDeleted(trx, TENANT, loc(), { actorUserId: 'u2' });
    await flush();
    expect(published()).toHaveLength(1);
    expect(published()[0].eventType).toBe('CLIENT_LOCATION_DELETED');
    expect(published()[0].payload).toMatchObject({ locationId: LOC, clientId: CLIENT, deletedByUserId: 'u2' });
  });
});
