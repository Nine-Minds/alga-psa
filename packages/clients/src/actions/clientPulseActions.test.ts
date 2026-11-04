/**
 * No-DB tests for the client pulse, driving the real action against a knex that
 * compiles statements instead of running them.
 *
 * Two things are pinned here, both from the 2026-10 production failure where the
 * client screen served nothing but "Could not load the client snapshot":
 *  1. the payments aggregate joins on `tenant` as well as `invoice_id`, so Citus
 *     can push the join to one shard instead of reaching for a second node's
 *     connection mid-transaction;
 *  2. a section that fails costs the snapshot that one card, not the page — and
 *     it unwinds through a savepoint, because a failed statement aborts the
 *     enclosing transaction and a bare try/catch would take the rest with it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import knexFactory from 'knex';

const TENANT = '11111111-1111-1111-1111-111111111111';
const CLIENT_ID = '22222222-2222-2222-2222-222222222222';

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const hasPermissionMock = vi.hoisted(() => vi.fn(async () => true));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: unknown[]) =>
    fn(
      { user_id: 'user-1', user_type: 'internal' },
      { tenant: '11111111-1111-1111-1111-111111111111' },
      ...args,
    ),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  withTransaction: async (db: unknown, callback: (trx: unknown) => Promise<unknown>) => callback(db),
}));

vi.mock('../lib/documentsHelpers', () => ({
  getContactAvatarUrlsBatchAsync: async () => new Map<string, string | null>(),
}));

vi.mock('@alga-psa/shared/billingClients/billingProfiles', () => ({
  listClientBillingProfiles: async () => [
    { billing_profile_id: 'profile-1', name: 'Default', is_default: true },
  ],
}));

import { getClientPulse } from './clientPulseActions';

type Rows = Record<string, unknown>[];

/**
 * A stand-in transaction: every builder compiles to SQL, the statement is
 * recorded, and `respond` decides what the statement "returns" (or throws).
 */
function recordingKnex(respond: (sql: string) => Rows) {
  const knex = knexFactory({ client: 'pg' });
  const statements: string[] = [];

  (knex.client as any).runner = (builder: any) => ({
    run: async () => {
      const compiled = builder.toSQL();
      const { sql, method } = Array.isArray(compiled) ? compiled[0] : compiled;
      statements.push(sql);
      const rows = respond(sql);
      return method === 'first' ? rows[0] : rows;
    },
  });

  return { knex, statements };
}

const clientRow = {
  client_id: CLIENT_ID,
  created_at: '2024-01-01T00:00:00.000Z',
  client_since: null,
  url: 'example.com',
  account_manager_id: null,
  is_inactive: false,
  properties: {},
  notes: null,
  notes_document_id: null,
  first_name: null,
  last_name: null,
  username: null,
  email: null,
};

const defaultRespond = (sql: string): Rows =>
  sql.includes('from "clients" as "c"') ? [clientRow] : [];

const findStatement = (statements: string[], fragment: string): string => {
  const match = statements.find((sql) => sql.includes(fragment));
  expect(match, `no statement containing ${fragment}`).toBeDefined();
  return match!;
};

describe('getClientPulse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPermissionMock.mockResolvedValue(true);
  });

  it('joins the completed-payments aggregate on the tenant distribution key', async () => {
    const { knex, statements } = recordingKnex(defaultRespond);
    createTenantKnexMock.mockResolvedValue({ knex });

    await getClientPulse(CLIENT_ID);

    const invoices = findStatement(statements, 'from "invoices" as "i"');
    expect(invoices).toContain('"ip"."invoice_id" = "i"."invoice_id"');
    expect(invoices).toContain('"ip"."tenant" = "i"."tenant"');
    // The aggregate can only be joined on the key if it carries it.
    expect(invoices).toContain('group by "tenant", "invoice_id"');
  });

  it('serves the rest of the snapshot when one section fails', async () => {
    const { knex, statements } = recordingKnex((sql) => {
      if (sql.includes('from "invoices" as "i"')) {
        throw new Error('connection to the server was lost');
      }
      return defaultRespond(sql);
    });
    createTenantKnexMock.mockResolvedValue({ knex });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const pulse = await getClientPulse(CLIENT_ID) as any;

    expect(pulse.money).toBeUndefined();
    expect(pulse.record).toBeDefined();
    expect(pulse.people).toBeDefined();
    expect(pulse.service).toBeDefined();
    expect(pulse.installBase).toBeDefined();
    expect(pulse.documents).toBeDefined();
    // Permissions still describe what the caller may see, so the UI keeps
    // offering the billing surfaces it has access to.
    expect(pulse.permissions.billing).toBe(true);
    expect(consoleError).toHaveBeenCalled();

    // The failure unwound through its own savepoint, which is what leaves the
    // transaction usable for the sections that follow.
    expect(statements).toContain('ROLLBACK TO SAVEPOINT client_pulse_money');
    expect(statements.filter((sql) => sql.startsWith('SAVEPOINT'))).toEqual([
      'SAVEPOINT client_pulse_service',
      'SAVEPOINT client_pulse_money',
      'SAVEPOINT client_pulse_install_base',
      'SAVEPOINT client_pulse_documents',
    ]);

    consoleError.mockRestore();
  });

  it('still fails the whole snapshot when the client itself cannot be read', async () => {
    const { knex } = recordingKnex(() => []);
    createTenantKnexMock.mockResolvedValue({ knex });

    const result = await getClientPulse(CLIENT_ID) as any;

    expect(result.actionError).toBe('Client not found');
  });
});
