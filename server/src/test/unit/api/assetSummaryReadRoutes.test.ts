import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const tenant = 'review-summary-tenant';
  const assetId = '33333333-3333-3333-3333-333333333333';
  const user = { user_id: 'summary-user', tenant, user_type: 'internal', roles: [{ role_id: 'summary-role' }] };
  const state = {
    tenant, assetId, user,
    asset: {} as Record<string, any>,
    extension: {} as Record<string, any>,
    tickets: [] as Record<string, any>[],
    redactions: { asset: [] as string[], ticket: [] as string[] },
    deniedIds: new Set<string>(),
    assetPermission: true, ticketPermission: true, keyOnly: false,
    subjects: [] as any[], loaded: [] as string[],
  };
  const decide = async (input: any) => {
    state.subjects.push(input.subject);
    return {
      allowed: !state.deniedIds.has(input.record?.id ?? input.resource.id),
      redactedFields: state.keyOnly && input.subject.apiKeyId !== 'summary-key'
        ? [] : state.redactions[input.resource.type as 'asset' | 'ticket'] ?? [],
    };
  };
  const table = (name: string) => {
    state.loaded.push(name);
    const root = name.split(' as ')[0];
    let rows = root === 'assets' ? [state.asset]
      : root === 'asset_associations' ? state.tickets
      : root === 'workstation_assets' || root === 'server_assets' ? [state.extension] : [];
    const key = (s: string) => s.split('.').at(-1)!;
    const q: any = {
      where(arg: any, value?: any) {
        const filters = typeof arg === 'string' ? { [key(arg)]: value } : arg;
        rows = rows.filter(r => Object.entries(filters).every(([k,v]) => r[key(k)] === v));
        return q;
      },
      whereIn(column: string, values: unknown[]) { rows = rows.filter(r => values.includes(r[key(column)])); return q; },
      select() { return q; },
      first() { return Promise.resolve(rows[0] ? { ...rows[0] } : undefined); },
      count() { return { first: async () => ({ count: String(rows.length) }) }; },
      then(resolve: any, reject: any) { return Promise.resolve(rows.map(r => ({...r}))).then(resolve, reject); },
      catch(reject: any) { return Promise.resolve(rows.map(r => ({...r}))).catch(reject); },
    };
    for (const method of ['join', 'leftJoin', 'orderBy']) q[method] = () => q;
    return q;
  };
  const knex: any = (name: string) => table(name);
  knex.transaction = async (fn: any) => fn(knex);
  return { state, decide, table, knex };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(h.state.user, { tenant: h.state.tenant }, ...args),
  withOptionalAuth: (fn: any) => (...args: any[]) => fn(h.state.user, { tenant: h.state.tenant }, ...args),
  hasPermission: vi.fn(async (_user: any, resource: string) => resource === 'ticket' ? h.state.ticketPermission : h.state.assetPermission),
  getCurrentUser: vi.fn(async () => h.state.user),
  runWithApiKeyUser: vi.fn(async (_user: any, fn: any) => fn()),
}));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: vi.fn(async (_user: any, resource: string) => resource === 'ticket' ? h.state.ticketPermission : h.state.assetPermission) }));
vi.mock('@/lib/api/middleware/apiAuthMiddleware', () => ({
  authenticateApiKeyRequest: vi.fn(async (request: any) => {
    request.context = { tenant: h.state.tenant, user: h.state.user, userId: h.state.user.user_id, apiKeyId: 'summary-key' };
    return request;
  }),
}));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => h.knex) }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: h.knex, tenant: h.state.tenant })),
  withTransaction: vi.fn(async (_knex: any, fn: any) => fn(h.knex)),
  tenantDb: (_knex: any, tenant: string) => ({
    table: (name: string) => h.table(name).where({ tenant }),
    tenantJoin: (q: any) => q,
  }),
}));
vi.mock('@/lib/api/services/AssetService', () => ({
  AssetService: class {
    async getAuthorizationRecord(id: string) {
      return h.state.asset.asset_id === id ? { id, clientId: h.state.asset.client_id } : null;
    }
  },
}));
vi.mock('server/src/lib/authorization/kernel', () => ({ getAuthorizationKernel: vi.fn(async () => ({ authorizeResource: h.decide })) }));
vi.mock('@alga-psa/authorization/kernel', () => ({
  BuiltinAuthorizationKernelProvider: class {}, BundleAuthorizationKernelProvider: class {}, RequestLocalAuthorizationCache: class {},
  createAuthorizationKernel: () => ({ authorizeResource: h.decide }),
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({ resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => []) }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn(), publishNonCatalogWorkflowEvent: vi.fn() }));

import { GET } from '../../../app/api/v1/assets/[id]/summary/route';

const read = async (key = false) => GET(new Request(`http://localhost/api/v1/assets/${h.state.assetId}/summary`, {
  headers: key ? { 'x-api-key': 'summary-secret' } : {},
}), { params: Promise.resolve({ id: h.state.assetId }) });

beforeEach(() => {
  h.state.asset = {
    tenant: h.state.tenant, asset_id: h.state.assetId, client_id: 'summary-client', asset_type: 'workstation',
    agent_status: 'offline', last_seen_at: '2020-01-01T12:00:00Z', warranty_end_date: '2099-01-15',
  };
  h.state.extension = {
    tenant: h.state.tenant, asset_id: h.state.assetId, antivirus_status: 'at_risk', antivirus_product: 'Visible AV', failed_patches: 7, pending_patches: 42,
  };
  h.state.tickets = Array.from({ length: 4 }, (_, i) => ({
    tenant: h.state.tenant, asset_id: h.state.assetId, entity_type: 'ticket', entity_id: `ticket-${i}`, ticket_id: `ticket-${i}`,
    status_id: 'open-status', is_closed: false, status_is_closed: false, client_id: 'summary-client',
  }));
  h.state.redactions = { asset: [], ticket: [] };
  h.state.deniedIds = new Set();
  h.state.subjects = []; h.state.loaded = [];
  h.state.assetPermission = true; h.state.ticketPermission = true; h.state.keyOnly = false;
});

describe('asset summary REST reads retain source policy', () => {
  it('visible control preserves calculations and open ticket count', async () => {
    const response = await read();
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      warranty_status: 'active', health_status: 'critical', security_status: 'critical',
      security_issues: ['Antivirus protection at risk', '7 failed patches', '42 pending patches'], open_tickets_count: 4,
    });
  });
  it.each(['assets.warranty_end_date', 'values.warranty_end_date', 'fields.assets.warranty_end_date'])(
    'does not expose warranty derived from %s', async alias => {
      h.state.redactions.asset = [alias];
      const response = await read();
      expect(response.status).toBe(200);
      const { data } = await response.json();
      expect(data.warranty_status ?? null).toBeNull(); expect(data.warranty_days_remaining ?? null).toBeNull();
    });
  it.each(['assets', 'assets.asset_id'])(
    'suppression by %s returns not found', async alias => {
      h.state.redactions.asset = [alias];
      expect((await read()).status).toBe(404);
    });
  it('does not copy hidden patch counts into security text', async () => {
    h.state.redactions.asset = ['workstation_assets.failed_patches'];
    expect(JSON.stringify(await (await read()).json())).not.toContain('7 failed patches');
  });
  it('does not reveal health derived from hidden agent status', async () => {
    h.state.redactions.asset = ['assets.agent_status'];
    const { data } = await (await read()).json();
    expect(data.health_status ?? null).toBeNull(); expect(data.health_reason ?? null).toBeNull();
  });
});

describe('summary source aliases, independent resources and controls', () => {
  it.each(['assets.warranty_status', 'fields.assets.warranty_status', 'values.warranty_status', 'warranty_status'])(
    'does not regenerate a directly hidden derived field %s', async alias => {
      h.state.redactions.asset = [alias];
      const { data } = await (await read()).json();
      expect(data.warranty_status ?? null).toBeNull();
      expect(data.health_status).toBe('critical');
    });

  it.each(['assets.last_seen_at', 'values.last_seen_at'])(
    'health retains timestamp provenance for %s', async alias => {
      h.state.redactions.asset = [alias];
      const { data } = await (await read()).json();
      expect(data.health_status).toBeNull(); expect(data.health_reason).toBeNull();
      expect(data.warranty_status).toBe('active');
    });

  for (const assetType of ['workstation', 'server']) {
    it.each([
      `${assetType}_assets.antivirus_status`, `${assetType}_assets.antivirus_product`,
      `${assetType}_assets.pending_patches`, `${assetType}_assets.failed_patches`,
      `fields.${assetType}_assets.failed_patches`, `${assetType}_assets`, `${assetType}_assets.asset_id`,
      'assets.extension_data.failed_patches', 'values.extension_data.failed_patches', 'fields.assets.extension_data.failed_patches',
      'values.extension_data', 'values.failed_patches',
    ])(`${assetType} security observes its source %s`, async alias => {
      h.state.asset.asset_type = assetType;
      h.state.redactions.asset = [alias];
      const response = await read();
      expect(response.status).toBe(200);
      const { data } = await response.json();
      expect(data.security_status).toBeNull(); expect(data.security_issues).toBeNull();
      expect(data.warranty_status).toBe('active'); expect(data.health_status).toBe('critical');
    });

    it(`${assetType} does not inherit the other extension table's rules`, async () => {
      h.state.asset.asset_type = assetType;
      h.state.redactions.asset = [`${assetType === 'server' ? 'workstation' : 'server'}_assets.failed_patches`];
      const { data } = await (await read()).json();
      expect(data.security_status).toBe('critical'); expect(data.security_issues).toContain('7 failed patches');
    });
  }

  it('hiding the asset discriminator also hides derived security', async () => {
    h.state.redactions.asset = ['assets.asset_type'];
    const { data } = await (await read()).json();
    expect(data.security_status).toBeNull(); expect(data.security_issues).toBeNull();
  });

  it('custom asset types preserve the visible no-extension control', async () => {
    h.state.asset.asset_type = 'cloud_account';
    const { data } = await (await read()).json();
    expect(data.security_status).toBe('secure'); expect(data.security_issues).toEqual([]);
    expect(data.warranty_status).toBe('active');
    expect(h.state.loaded).not.toContain('workstation_assets'); expect(h.state.loaded).not.toContain('server_assets');
  });

  it('retains key-only policies while session callers remain a visible control', async () => {
    h.state.keyOnly = true;
    h.state.redactions.asset = ['assets.warranty_end_date'];
    const restricted = await read(true);
    expect(restricted.status).toBe(200);
    expect((await restricted.json()).data.warranty_status).toBeNull();
    expect(h.state.subjects.every(subject => subject.apiKeyId === 'summary-key')).toBe(true);
    expect((await (await read()).json()).data.warranty_status).toBe('active');
  });

  it.each(['assets', 'values.asset_id', 'fields.assets.asset_id'])(
    'key-only suppression by %s happens before loading metrics', async alias => {
      h.state.keyOnly = true; h.state.redactions.asset = [alias];
      expect((await read(true)).status).toBe(404); expect(h.state.loaded).toEqual([]);
    });

  it('record denial is indistinguishable from a missing asset and skips metric loading', async () => {
    h.state.deniedIds.add(h.state.assetId);
    expect((await read()).status).toBe(404); expect(h.state.loaded).toEqual([]);
    h.state.asset = {};
    expect((await read()).status).toBe(404); expect(h.state.loaded).toEqual([]);
  });

  it('coarse RBAC denies before any authorization or metric load', async () => {
    h.state.assetPermission = false;
    expect((await read()).status).toBe(403); expect(h.state.subjects).toEqual([]); expect(h.state.loaded).toEqual([]);
  });

  it('does not mutate source facts while redacting the response', async () => {
    const original = structuredClone({ asset: h.state.asset, extension: h.state.extension, tickets: h.state.tickets });
    h.state.redactions.asset = ['assets.warranty_end_date', 'values.extension_data.failed_patches'];
    const { data } = await (await read()).json();
    expect(data.warranty_status).toBeNull(); expect(data.security_issues).toBeNull();
    expect({ asset: h.state.asset, extension: h.state.extension, tickets: h.state.tickets }).toEqual(original);
  });
});

describe('open-ticket count observes both retained policies before its status predicate', () => {
  for (const owner of ['asset', 'ticket'] as const) {
    it.each([
      'asset_associations', 'asset_associations.entity_id', 'asset_associations.asset_id', 'asset_associations.entity_type',
      'tickets', 'tickets.ticket_id', 'values.ticket_id', 'fields.tickets.ticket_id',
      'statuses', 'statuses.is_closed', 'fields.statuses.is_closed', 'statuses.status_id', 'tickets.status_id',
    ])(`${owner} decision suppresses counted source %s`, async alias => {
      h.state.redactions[owner] = [alias];
      const response = await read(true);
      expect(response.status).toBe(200);
      const { data } = await response.json();
      expect(data.open_tickets_count).toBe(0); expect(data.warranty_status).toBe('active');
    });
  }

  it('independently denied tickets are excluded from the count', async () => {
    h.state.deniedIds.add('ticket-1');
    expect((await (await read(true)).json()).data.open_tickets_count).toBe(3);
  });

  it('closed tickets are excluded after projection', async () => {
    h.state.tickets[0].status_is_closed = true; h.state.tickets[0].is_closed = true;
    expect((await (await read()).json()).data.open_tickets_count).toBe(3);
  });

  it.each(['tickets.title', 'asset_associations.notes', 'statuses.name'])(
    'unrelated visible-member redaction %s does not change the aggregate', async alias => {
      h.state.redactions.asset = [alias]; h.state.redactions.ticket = [alias];
      expect((await (await read()).json()).data.open_tickets_count).toBe(4);
    });

  it('does not load or count related tickets without ticket read permission', async () => {
    h.state.ticketPermission = false;
    expect((await (await read()).json()).data.open_tickets_count).toBe(0);
    expect(h.state.loaded).not.toContain('asset_associations');
  });

  it('honors direct summary count redaction after calculating the visible aggregate', async () => {
    h.state.redactions.asset = ['assets.open_tickets_count'];
    expect((await (await read()).json()).data.open_tickets_count).toBeNull();
  });
});

describe('shared UI summary calculation', () => {
  it('preserves the existing authorized action result after extracting the calculation', async () => {
    const { getAssetSummaryMetrics } = await import('@alga-psa/assets/actions/assetActions');
    h.state.tickets[0].is_closed = true;
    const metrics = await getAssetSummaryMetrics(h.state.assetId);
    expect(metrics).toMatchObject({
      warranty_status: 'active', health_status: 'critical', security_status: 'critical', open_tickets_count: 3,
      security_issues: ['Antivirus protection at risk', '7 failed patches', '42 pending patches'],
    });
  });
});
