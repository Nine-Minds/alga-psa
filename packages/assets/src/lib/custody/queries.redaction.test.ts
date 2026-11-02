import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  redactions: [] as string[],
  deniedIds: new Set<string>(),
  subjects: [] as any[],
}));

const candidates = vi.hoisted(() => [
  {
    custody_id: 'review-custody', asset_id: 'review-asset', client_id: 'review-client', asset_client_id: 'review-client',
    state: 'in_office', purpose: 'repair', next_action_party: 'msp', condition_note: 'PRIVATE-CONDITION',
    opened_at: '2026-10-15T12:00:00Z', closed_at: null as string | null, created_at: '2026-10-15T12:00:00Z', updated_at: '2026-10-15T12:00:00Z',
    asset_name: 'PRIVATE-ASSET-NAME', asset_tag: 'Visible Tag', holder_user_id: 'private-holder', holder_name: 'PRIVATE-HOLDER',
    follow_up_on: '2026-11-03', location_id: 'review-location', location_name: 'Visible Location', ticket_id: null,
    client_name: 'PRIVATE-CLIENT',
  },
]);

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (table: string) => {
      const result = table === 'asset_associations' ? [] : candidates;
      const query: any = {};
      for (const method of ['whereIn', 'where', 'whereNull', 'leftJoin', 'join', 'orderByRaw', 'orderBy']) {
        query[method] = () => query;
      }
      query.select = async () => result;
      return query;
    },
  }),
}));

import { listCustodyQueue } from './queries';

const authorizationContext = () => ({
  subject: { tenant: 'review-tenant', userId: 'review-user', userType: 'internal', apiKeyId: 'review-api-key' },
  authorizationKernel: {
    authorizeResource: vi.fn(async ({ subject, resource }: any) => {
      state.subjects.push({ subject, resource });
      return {
        allowed: !state.deniedIds.has(resource.id),
        redactedFields: state.redactions,
      };
    }),
  },
  requestCache: {},
}) as any;

async function query(redactions: string[] = [], filters: Record<string, unknown> = {}) {
  state.redactions = redactions;
  const context = authorizationContext();
  const page = await listCustodyQueue(
    { raw: (value: string) => value } as any,
    'review-tenant',
    context,
    { tab: 'all_open', ...filters } as any,
    { today: '2026-11-02', userId: 'review-user' },
  );
  expect(context.authorizationKernel.authorizeResource).toHaveBeenCalled();
  return page;
}

beforeEach(() => {
  state.redactions = [];
  state.deniedIds = new Set();
  state.subjects = [];
});

describe('custody queue projects candidates before filters and totals', () => {
  it('returns readable queue values as a visible control and retains API-key identity', async () => {
    const page = await query();
    expect(page.total).toBe(1);
    expect(page.rows[0].asset_name).toBe('PRIVATE-ASSET-NAME');
    expect(page.rows[0].condition_note).toBe('PRIVATE-CONDITION');
    expect(page.rows[0].holder_name).toBe('PRIVATE-HOLDER');
    expect(page.rows[0]).not.toHaveProperty('_a');
    expect(state.subjects[0].subject.apiKeyId).toBe('review-api-key');
  });

  it.each([
    ['assets.name', 'PRIVATE-ASSET-NAME'],
    ['asset_custody.condition_note', 'PRIVATE-CONDITION'],
    ['asset_custody.holder_user_id', 'PRIVATE-HOLDER'],
    ['asset_custody.opened_at', ''],
  ])('projects queue field dependencies for %s', async (alias, hiddenValue) => {
    const page = await query([alias]);
    if (hiddenValue) expect(JSON.stringify(page)).not.toContain(hiddenValue);
    if (alias === 'asset_custody.opened_at') expect(page.rows[0].days_held).toBeNull();
    expect(page.total).toBe(1);
  });

  it.each(['assets', 'assets.asset_id', 'asset_custody', 'asset_custody.custody_id'])(
    'suppression by %s excludes the candidate from rows, total, and tab counts', async (alias) => {
      const page = await query([alias], { page: 1, pageSize: 1 });
      expect(page.rows).toEqual([]);
      expect(page.total).toBe(0);
      expect(page.tabCounts.all_open).toBe(0);
    },
  );

  it('does not use a hidden field for a queue filter', async () => {
    const page = await query(['asset_custody.purpose'], { purpose: 'repair' });
    expect(page.rows).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.tabCounts.all_open).toBe(0);
  });

  it('filters closed episodes only after the candidate has been projected', async () => {
    const closed = { ...candidates[0], custody_id: 'closed-custody', closed_at: '2026-10-20T12:00:00Z' };
    candidates.push(closed);
    try {
      const page = await query();
      expect(page.rows.map((row) => row.custody_id)).toEqual(['review-custody']);
      expect(page.total).toBe(1);
    } finally {
      candidates.pop();
    }
  });

  it('hides the joined client label when the custody-side join key is hidden', async () => {
    const page = await query(['asset_custody.client_id']);
    expect(page.total).toBe(1);
    expect(page.rows[0].client_name ?? null).toBeNull();
  });
});
