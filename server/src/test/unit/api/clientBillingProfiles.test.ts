/**
 * Read-only client billing profiles (GET /clients/{id}/billing-profiles[/{profileId}]).
 * The service runs against a recording fake query builder: it asserts the scope guard, the
 * client-ownership guard (404, never 403), ordering, tenant-safe left joins and row mapping.
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  permitted: new Set<string>(),
  profiles: [] as any[],
  clients: [] as any[],
  joins: [] as any[],
  orderBys: [] as Array<[string, string]>,
  wheres: [] as any[],
}));

vi.mock('@alga-psa/db', async () => {
  const actual: any = await vi.importActual('@alga-psa/db').catch(() => ({}));
  class BaseService {
    constructor(_options?: unknown) {}
    protected async getKnex() { return { knex: {}, tenant: 'tenant-1' }; }
  }
  const builder = (rows: () => any[]) => {
    const q: any = {
      where(cond: any) { state.wheres.push(cond); return q; },
      orderBy(col: string, dir: string) { state.orderBys.push([col, dir]); return q; },
      select() { return q; },
      first(...cols: string[]) {
        const cond = state.wheres[state.wheres.length - 1] ?? {};
        const found = rows().find((r) => Object.entries(cond).every(([k, v]) => r[k.replace(/^cbp\./, '')] === v));
        return Promise.resolve(cols.length ? found && { client_id: found.client_id } : found);
      },
      then(res: any, rej: any) {
        const cond = state.wheres[state.wheres.length - 1] ?? {};
        const list = rows().filter((r) => Object.entries(cond).every(([k, v]) => r[k.replace(/^cbp\./, '')] === v));
        const sorted = [...list].sort((a, b) =>
          Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name) ||
          a.billing_profile_id.localeCompare(b.billing_profile_id));
        return Promise.resolve(sorted).then(res, rej);
      },
    };
    return q;
  };
  return {
    ...actual,
    BaseService,
    withTransaction: async (_knex: unknown, fn: (trx: unknown) => unknown) => fn({}),
    tenantDb: () => ({
      table: (name: string) => builder(() => (name === 'clients' ? state.clients : state.profiles)),
      tenantJoin: (_q: unknown, table: string, a: string, b: string, opts: unknown) => {
        state.joins.push({ table, a, b, opts });
      },
    }),
  };
});

vi.mock('@alga-psa/authorization/clientScopeAuthorization', () => ({
  createClientScopeContext: async () => ({
    permits: async (_kind: string, id: string) => state.permitted.has(id),
    narrowing: () => '',
  }),
}));
vi.mock('server/src/lib/db', () => ({ runWithTenant: vi.fn() }));
vi.mock('server/src/lib/eventBus/publishers', () => ({}));
vi.mock('@alga-psa/workflow-streams', () => ({}));
vi.mock('@alga-psa/db/models/user', () => ({}), { virtual: true } as any);

import { ClientService } from '@/lib/api/services/ClientService';
import { NotFoundError } from '@/lib/api/middleware/apiMiddleware';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ctx: any = { tenant: 'tenant-1', userId: 'u1' };

const profile = (over: any) => ({
  tenant: 'tenant-1', client_id: A, is_default: false, is_system_managed_default: false, is_active: true,
  bills_separately: false, ...over,
});

beforeEach(() => {
  state.permitted = new Set([A, B]);
  state.joins = []; state.orderBys = []; state.wheres = [];
  state.clients = [{ client_id: A }, { client_id: B }];
  state.profiles = [
    profile({ billing_profile_id: 'p-z', name: 'Zeta' }),
    profile({ billing_profile_id: 'p-def', name: 'Main', is_default: true, is_system_managed_default: true,
      payment_terms: 'net_30', bill_to_location_name: 'HQ', bill_to_location_id: 'loc-1',
      billing_contact_name: 'Pat Doe', billing_contact_id: 'c-1',
      invoice_template_name: 'Fancy', invoice_template_id: 't-1', created_at: new Date('2026-01-01T00:00:00Z') }),
    profile({ billing_profile_id: 'p-a', name: 'Alpha', is_active: false }),
    profile({ billing_profile_id: 'p-b-owned', client_id: B, name: 'Other client profile', payment_terms: 'net_15' }),
  ];
});

describe('ClientService.getBillingProfile', () => {
  it('404s for a profile that belongs to another client, without returning profile data', async () => {
    const err = await new ClientService().getBillingProfile(A, 'p-b-owned', ctx).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(JSON.stringify(err.message)).not.toContain('Other client profile');
  });

  it('404s for an unknown profile', async () => {
    await expect(new ClientService().getBillingProfile(A, 'nope', ctx)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('404s (not 403) for an unknown client and for a client outside the caller scope', async () => {
    state.permitted = new Set([B]);
    await expect(new ClientService().getBillingProfile(A, 'p-def', ctx)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new ClientService().getBillingProfile('33333333-3333-4333-8333-333333333333', 'p-def', ctx))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns display names, UI fields and nulls for unset ids', async () => {
    const svc = new ClientService();
    const full: any = await svc.getBillingProfile(A, 'p-def', ctx);
    expect(full).toMatchObject({
      billing_profile_id: 'p-def', client_id: A, name: 'Main', is_default: true, is_active: true,
      payment_terms: 'net_30', bill_to_location_name: 'HQ', billing_contact_name: 'Pat Doe',
      invoice_template_name: 'Fancy', created_at: '2026-01-01T00:00:00.000Z',
    });
    const bare: any = await svc.getBillingProfile(A, 'p-a', ctx);
    expect(bare).toMatchObject({
      is_active: false, bill_to_location_id: null, bill_to_location_name: null, billing_contact_id: null,
      billing_contact_name: null, invoice_template_id: null, invoice_template_name: null,
      payment_terms: null, preferred_payment_method: null, is_tax_exempt: null, po_required: null,
    });
    for (const key of ['bills_separately', 'bill_to_name', 'billing_email', 'tax_id_number', 'po_number',
      'invoice_delivery_method', 'billing_cycle', 'tax_exemption_certificate']) {
      expect(bare).toHaveProperty(key);
    }
  });

  it('joins display names tenant-safely with left joins', async () => {
    await new ClientService().getBillingProfile(A, 'p-def', ctx);
    expect(state.joins.map((j) => j.table).sort()).toEqual(['client_locations as loc', 'contacts as bc', 'invoice_templates as it']);
    for (const j of state.joins) expect(j.opts).toEqual({ type: 'left' });
  });
});

describe('ClientService.listBillingProfiles', () => {
  it('404s for a missing or out-of-scope client', async () => {
    state.permitted = new Set([B]);
    await expect(new ClientService().listBillingProfiles(A, ctx)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('404s for an unknown client even when the caller is unscoped (not an empty list)', async () => {
    const unknown = '33333333-3333-4333-8333-333333333333';
    state.permitted = new Set([A, B, unknown]);
    await expect(new ClientService().listBillingProfiles(unknown, ctx)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns an empty list for an existing client with no profiles', async () => {
    const empty = '44444444-4444-4444-8444-444444444444';
    state.permitted.add(empty);
    state.clients.push({ client_id: empty });
    await expect(new ClientService().listBillingProfiles(empty, ctx)).resolves.toEqual([]);
  });

  it('lists only the client\'s profiles: default first, then by name, inactive included', async () => {
    const rows = await new ClientService().listBillingProfiles(A, ctx);
    expect(rows.map((r) => r.billing_profile_id)).toEqual(['p-def', 'p-a', 'p-z']);
    expect(rows.find((r) => r.billing_profile_id === 'p-a')!.is_active).toBe(false);
    expect(state.orderBys).toEqual([
      ['cbp.is_default', 'desc'], ['cbp.name', 'asc'], ['cbp.billing_profile_id', 'asc'],
    ]);
  });
});

function readSource(relative: string): string {
  return fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
}

describe('billing profile routes and controller', () => {
  it('exposes GET only, and keeps the contacts route', () => {
    const list = readSource('../../../app/api/v1/clients/[id]/billing-profiles/route.ts');
    const one = readSource('../../../app/api/v1/clients/[id]/billing-profiles/[profileId]/route.ts');
    expect(list).toContain('export const GET = controller.listBillingProfiles();');
    expect(one).toContain('export const GET = controller.getBillingProfile();');
    for (const src of [list, one]) {
      expect(src).not.toMatch(/export const (POST|PUT|PATCH|DELETE)/);
      expect(src).toContain("export const dynamic = 'force-dynamic';");
    }
    expect(readSource('../../../app/api/v1/clients/[id]/billing-profiles/[profileId]/contacts/route.ts'))
      .toContain('controller.getBillingProfileContacts()');
  });

  it('gates on the client read permission, not billing_profile:read', () => {
    const controller = readSource('../../../lib/api/controllers/ApiClientController.ts');
    for (const name of ['listBillingProfiles() {', 'getBillingProfile() {']) {
      const body = controller.slice(controller.indexOf(`  ${name}`)).split('\n  }\n')[0];
      expect(body).toContain("this.options.permissions?.read || 'read'");
      expect(body).not.toContain('billing_profile');
    }
  });
});
