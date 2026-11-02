import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setRequestContext } from '@/lib/api/utils/requestContext';

const state = vi.hoisted(() => ({
  redactions: [] as string[],
  calls: [] as string[],
  subjects: [] as any[],
}));

vi.mock('@/lib/productAccess', () => ({
  getTenantProduct: vi.fn(async () => 'psa'),
  ProductAccessError: class extends Error {},
}));
vi.mock('@/lib/productSurfaceRegistry', () => ({ resolveProductApiBehavior: () => 'allowed' }));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));
vi.mock('@/lib/api/services/AssetService', () => ({
  AssetService: class {
    async getAuthorizationRecord(id: string) { return { id, clientId: 'review-client' }; }
  },
}));
vi.mock('server/src/lib/authorization/kernel', () => ({
  getAuthorizationKernel: vi.fn(async () => ({
    authorizeResource: vi.fn(async ({ subject }: any) => {
      state.subjects.push(subject);
      return { allowed: true, redactedFields: state.redactions };
    }),
  })),
}));
vi.mock('@alga-psa/assets/lib/custody/service', () => ({
  getAssetCustodyService: vi.fn(async () => {
    state.calls.push('get');
    return {
      open: {
        custody_id: 'review-custody', asset_id: 'review-asset', condition_note: 'PRIVATE-CONDITION',
        holder_user_id: 'private-holder', holder_name: 'PRIVATE-HOLDER',
        location_id: 'private-location', location_name: 'PRIVATE-LOCATION',
        ticket_id: 'private-ticket', ticket_number: 'PRIVATE-TICKET-NUMBER',
      },
      episodes: [],
    };
  }),
  listCustodyEventsService: vi.fn(async () => {
    state.calls.push('events');
    return [{
      event_id: 'private-event', asset_id: 'review-asset', custody_id: 'review-custody', note: 'PRIVATE-EVENT-NOTE',
      actor_user_id: 'private-actor', actor_name: 'PRIVATE-ACTOR',
      to_location_id: 'private-location', to_location_name: 'PRIVATE-LOCATION',
    }];
  }),
  resolveCustodyToday: vi.fn(async () => '2026-11-02'),
  listCustodyQueueService: vi.fn(),
  openCustodyService: vi.fn(),
  recordCustodyEventService: vi.fn(),
}));

const { ApiAssetCustodyController } = await import('@/lib/api/controllers/ApiAssetCustodyController');

function request(apiKeyId?: string) {
  const req = new Request('http://localhost/api/v1/assets/review-asset/custody') as any;
  setRequestContext(req, {
    tenant: 'review-tenant',
    user: { user_id: 'review-user', tenant: 'review-tenant', user_type: 'internal' },
    apiKeyId,
  } as any);
  return req;
}

async function read(redactions: string[] = []) {
  state.redactions = redactions;
  return new ApiAssetCustodyController().get(request('assigned-review-key') as any, { id: 'review-asset' });
}

beforeEach(() => {
  state.redactions = [];
  state.calls = [];
  state.subjects = [];
});

describe('asset custody GET uses retained asset projections', () => {
  it('returns visible episode and event data as a control', async () => {
    const response = await read();
    expect(response.status).toBe(200);
    const body = JSON.stringify(await response.json());
    expect(body).toContain('PRIVATE-CONDITION');
    expect(body).toContain('PRIVATE-EVENT-NOTE');
    expect(body).toContain('PRIVATE-HOLDER');
    expect(state.subjects.at(-1)?.apiKeyId).toBe('assigned-review-key');
  });

  it.each(['asset_custody.condition_note', 'values.condition_note', 'fields.asset_custody.condition_note'])(
    'redacts episode notes through %s', async (alias) => {
      const response = await read([alias]);
      expect(response.status).toBe(200);
      expect(JSON.stringify(await response.json())).not.toContain('PRIVATE-CONDITION');
    },
  );

  it.each(['asset_custody_events.note', 'fields.asset_custody_events.note'])(
    'redacts event notes through %s', async (alias) => {
      const response = await read([alias]);
      expect(response.status).toBe(200);
      expect(JSON.stringify(await response.json())).not.toContain('PRIVATE-EVENT-NOTE');
    },
  );

  it.each(['asset_custody_events', 'asset_custody_events.event_id'])(
    'suppresses events through %s', async (alias) => {
      const response = await read([alias]);
      expect((await response.json()).data.events).toEqual([]);
    },
  );

  it.each(['asset_custody', 'asset_custody.custody_id'])(
    'suppresses episodes through %s', async (alias) => {
      const response = await read([alias]);
      expect((await response.json()).data.open).toBeNull();
    },
  );

  it('hides the joined holder label when its source foreign key is hidden', async () => {
    const response = await read(['asset_custody.holder_user_id']);
    expect(JSON.stringify(await response.json())).not.toContain('PRIVATE-HOLDER');
  });

  it.each([
    ['users.first_name', 'PRIVATE-HOLDER'],
    ['users.last_name', 'PRIVATE-ACTOR'],
    ['users.user_id', 'PRIVATE-HOLDER'],
    ['users', 'PRIVATE-ACTOR'],
    ['stock_locations.name', 'PRIVATE-LOCATION'],
    ['stock_locations.location_id', 'PRIVATE-LOCATION'],
    ['stock_locations', 'PRIVATE-LOCATION'],
    ['tickets.ticket_number', 'PRIVATE-TICKET-NUMBER'],
    ['tickets.ticket_id', 'PRIVATE-TICKET-NUMBER'],
    ['tickets', 'PRIVATE-TICKET-NUMBER'],
  ])('redaction %s hides its copied custody label', async (alias, hiddenValue) => {
    const response = await read([alias]);
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain(hiddenValue);
  });

  it('suppresses an asset before loading its custody data', async () => {
    const response = await read(['assets']);
    expect(response.status).toBe(404);
    expect(state.calls).toEqual([]);
  });
});
