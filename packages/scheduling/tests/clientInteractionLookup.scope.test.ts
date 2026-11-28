import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Harness: the authorization scope probe, subject resolver and rule compiler are mocked; the
// real createClientScopeContext runs on top of them against a recording fake knex.
const hasPermissionMock = vi.hoisted(() => vi.fn());
const probeMock = vi.hoisted(() => vi.fn());
const resolveSubjectMock = vi.hoisted(() => vi.fn());
const resolveRulesMock = vi.hoisted(() => vi.fn());
const projectMock = vi.hoisted(() => vi.fn());

const state = vi.hoisted(() => ({
  statements: [] as string[],
  clientSelects: [] as string[],
  clients: {} as Record<string, any>,
  interactions: {} as Record<string, any>,
  allowedClientIds: new Set<string>(),
  trxs: new Set<unknown>(),
  scopeConns: [] as unknown[],
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: unknown[]) =>
    fn(state.currentUser, { tenant: 'tenant-1' }, ...args),
  hasPermission: (...args: unknown[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/auth/lib/clientBillingProjection', () => ({
  projectClientForSubject: (...args: unknown[]) => projectMock(...args),
}));

function makeBuilder(table: string) {
  const baseTable = table.split(' as ')[0];
  const b: any = {
    _where: {} as Record<string, unknown>,
    _restricted: false,
    _selectAll: false,
  };
  b.select = (...cols: string[]) => {
    if (baseTable === 'clients' && cols[0] === '*') {
      b._selectAll = true;
    }
    return b;
  };
  b.where = (a: any, v?: unknown) => {
    if (typeof a === 'string') b._where[a] = v;
    else Object.assign(b._where, a);
    return b;
  };
  b.andWhere = (fn: any) => {
    fn.call(b);
    return b;
  };
  b.leftJoin = () => b;
  b.join = () => b;
  b.modify = (fn: any) => {
    fn(b);
    return b;
  };
  b.first = async (col?: string) => {
    state.statements.push(`first:${table}`);
    if (baseTable === 'clients') {
      const id = (b._where.client_id ?? b._where['r.client_id']) as string | null;
      if (b._selectAll) state.clientSelects.push(String(id));
      if (b._restricted && !(id != null && state.allowedClientIds.has(id))) return undefined;
      const row = id != null ? state.clients[id] : undefined;
      if (!row) return undefined;
      return col ? { [col.replace('r.', '')]: id } : row;
    }
    if (baseTable === 'interactions') {
      return state.interactions[String(b._where['interactions.interaction_id'])];
    }
    return undefined;
  };
  return b;
}

vi.mock('@alga-psa/db', () => {
  const tenantDb = (conn: any, tenant: string) => ({
    tenant,
    table: (table: string) => {
      state.statements.push(`table:${table}`);
      return makeBuilder(table);
    },
    tenantJoin: (query: any) => query,
    unscoped: (table: string) => makeBuilder(table),
  });
  return {
    createTenantKnex: async () => ({ knex: state.knex }),
    tenantDb,
    withTransaction: async (knex: any, cb: any) => {
      const trx: any = (table: string) => makeBuilder(table);
      trx.raw = (s: string) => s;
      state.trxs.add(trx);
      return cb(trx);
    },
  };
});

vi.mock('@alga-psa/authorization/subject', () => ({
  probeTenantAuthorizationScope: (...args: unknown[]) => {
    state.statements.push('probe');
    state.scopeConns.push(args[0]);
    return probeMock(...args);
  },
  resolveAuthorizationSubject: (...args: unknown[]) => {
    state.statements.push('resolve-subject');
    return resolveSubjectMock(...args);
  },
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: (...args: unknown[]) => {
    state.statements.push('resolve-rules');
    return resolveRulesMock(...args);
  },
}));

// The registry, `builtinResolversRestrict` and `closedBundlesNotNaming` are the real ones: only the SQL compiler is faked.
vi.mock('@alga-psa/authorization/kernel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/authorization/kernel')>();
  return {
    ...actual,
    RequestLocalAuthorizationCache: class {},
    matchRulesForAction: (rules: unknown[]) => rules,
    compileResourceReadAuthorizationSql: (qb: any) => {
      qb._restricted = true;
      return { supported: true };
    },
  };
});

vi.mock('@alga-psa/authorization/clientScopeSqlAdapters', () => ({
  createClientRelationshipSqlAdapter: () => ({ clientColumn: 'r.client_id' }),
  createContactRelationshipSqlAdapter: () => ({ clientColumn: null }),
}));

import {
  registerBuiltinRuleResolver,
  resetBuiltinRuleResolversForTests,
  type BuiltinRuleResolver,
} from '@alga-psa/authorization/kernel';
import {
  getSchedulingClientById,
  getSchedulingInteractionById,
} from '../src/actions/clientInteractionLookupActions';

const SEAT = { user_id: 'seat-1', user_type: 'internal' };
const INTERNAL = { user_id: 'staff-1', user_type: 'internal' };

// The co-managed seat's built-in resolver, registered as packages/co-managed does (registerBuiltinRuleResolver): closed
// baseline, `client:read` limited to the arrangement client, and no bundle rule or published assignment anywhere.
const SEAT_RESOLVER_ID = 'co_managed_seat';
const seatResolver: BuiltinRuleResolver = {
  id: SEAT_RESOLVER_ID,
  baseline: 'closed',
  appliesTo: (input) => Boolean(input.subject.resolverFacts?.[SEAT_RESOLVER_ID]),
  resolveRules: (input) => {
    const facts = input.subject.resolverFacts?.[SEAT_RESOLVER_ID] as { clientId: string } | undefined;
    return facts
      ? [{ id: 'seat:client:read:own_client', resource: 'client', action: 'read', templateKey: 'selected_clients', selectedClientIds: [facts.clientId] }]
      : [];
  },
} as BuiltinRuleResolver;

function narrowToOwnClient() {
  // Resolver subjects exist, but no bundle is published and no bundle rule resolves.
  probeMock.mockResolvedValue({ publishedAssignments: false, resolverSubjects: true });
  resolveSubjectMock.mockResolvedValue({
    userId: 'seat-1', userType: 'internal', resolverFacts: { [SEAT_RESOLVER_ID]: { clientId: 'client-own' } },
  });
  resolveRulesMock.mockResolvedValue([]);
  state.allowedClientIds = new Set(['client-own']);
}

describe('scheduling client/interaction lookups enforce client scope', () => {
  beforeAll(() => {
    resetBuiltinRuleResolversForTests();
    registerBuiltinRuleResolver(seatResolver);
  });
  afterAll(() => resetBuiltinRuleResolversForTests());

  beforeEach(() => {
    vi.clearAllMocks();
    state.statements = [];
    state.clientSelects = [];
    state.scopeConns = [];
    state.trxs = new Set();
    state.allowedClientIds = new Set();
    (state as any).knex = { pool: true };
    state.clients = {
      'client-own': { client_id: 'client-own', client_name: 'Own', billing_email: 'b@own' },
      'client-other': { client_id: 'client-other', client_name: 'Other', billing_email: 'b@other' },
    };
    state.interactions = {
      'int-own': { interaction_id: 'int-own', client_id: 'client-own', type_name: 'Call' },
      'int-other': { interaction_id: 'int-other', client_id: 'client-other', type_name: 'Call' },
      'int-null': { interaction_id: 'int-null', client_id: null, type_name: 'Call' },
    };
    hasPermissionMock.mockResolvedValue(true);
    projectMock.mockImplementation((_u: unknown, c: any) => (c ? { ...c, billing_email: undefined } : c));
    (state as any).currentUser = SEAT;
    probeMock.mockResolvedValue({ publishedAssignments: false, resolverSubjects: false });
  });

  it('seat requesting a client outside its scope gets null and no clients select(*) is issued', async () => {
    narrowToOwnClient();
    const result = await getSchedulingClientById('client-other');
    expect(result).toBeNull();
    expect(state.clientSelects).toEqual([]);
    expect(projectMock).toHaveBeenCalledWith(expect.anything(), null);
  });

  it('seat requesting its own client gets it, with the billing projection applied', async () => {
    narrowToOwnClient();
    const result = (await getSchedulingClientById('client-own')) as any;
    expect(result.client_id).toBe('client-own');
    expect(result.billing_email).toBeUndefined();
    expect(projectMock).toHaveBeenCalledTimes(1);
    expect(state.clientSelects).toEqual(['client-own']);
    // scope is built from the transaction, not the pool knex
    expect(state.scopeConns.every((c) => state.trxs.has(c))).toBe(true);
    expect(state.scopeConns.length).toBeGreaterThan(0);
  });

  it('seat requesting an out-of-scope interaction gets "Interaction not found"', async () => {
    narrowToOwnClient();
    await expect(getSchedulingInteractionById('int-other')).rejects.toThrow('Interaction not found');
    await expect(getSchedulingInteractionById('missing')).rejects.toThrow('Interaction not found');
    // null client_id fails closed under narrowing
    await expect(getSchedulingInteractionById('int-null')).rejects.toThrow('Interaction not found');
    const own = await getSchedulingInteractionById('int-own');
    expect(own.interaction_id).toBe('int-own');
    expect(state.scopeConns.every((c) => state.trxs.has(c))).toBe(true);
  });

  it('fast path (no published assignments): only the scope probe is added, no resolver/narrowing queries', async () => {
    const result = (await getSchedulingClientById('client-other')) as any;
    expect(result.client_id).toBe('client-other');
    expect(state.statements).toEqual(['probe', 'table:clients', 'first:clients']);
    expect(resolveSubjectMock).not.toHaveBeenCalled();
    expect(resolveRulesMock).not.toHaveBeenCalled();

    state.statements = [];
    const i = await getSchedulingInteractionById('int-null');
    expect(i.interaction_id).toBe('int-null');
    expect(state.statements.filter((s) => s !== 'probe').some((s) => /resolve/.test(s))).toBe(false);
    expect(state.statements.filter((s) => s === 'probe')).toHaveLength(1);
  });

  it('non-seat internal user is unaffected and still reads the client and the interaction', async () => {
    (state as any).currentUser = INTERNAL;
    const client = (await getSchedulingClientById('client-other')) as any;
    expect(client.client_id).toBe('client-other');
    const interaction = await getSchedulingInteractionById('int-other');
    expect(interaction.interaction_id).toBe('int-other');
    expect(interaction.type_name).toBe('call');
  });
});
