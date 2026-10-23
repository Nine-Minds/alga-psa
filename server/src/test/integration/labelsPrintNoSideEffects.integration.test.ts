/**
 * alga-2026-0002683 C2 - T-noside: printing labels writes nothing and publishes nothing.
 *
 * Runs the real composition (`printLabels` with the real ticket / asset providers, the linked-asset
 * merge and the template resolver) against a seeded database, with a knex query listener that fails on
 * any statement that is not a SELECT, and before/after row counts + max(updated_at) for every table a
 * print could plausibly touch (stock, billing, time, assets, tickets, documents).
 *
 * Needs a seeded Postgres (createTestDbConnection) with at least one ticket and one asset in a tenant.
 * It FAILS (does not skip) if the fixtures are missing.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

const published = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const auth = vi.hoisted(() => ({ tenant: '' }));

vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: published, publishWorkflowEvent: published }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/auth/rbac', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth/rbac')>()),
  hasPermission: vi.fn().mockResolvedValue(true),
}));
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return { ...actual, createTenantKnex: async () => ({ knex: db, tenant: auth.tenant }) };
});

let db: Knex;

const WATCHED_TABLES = [
  'stock_levels', 'stock_units', 'stock_movements', 'invoices', 'invoice_charges', 'time_entries',
  'assets', 'asset_history', 'tickets', 'documents',
];

async function snapshot(): Promise<Record<string, { count: number; maxUpdatedAt: string | null }>> {
  const out: Record<string, { count: number; maxUpdatedAt: string | null }> = {};
  for (const name of WATCHED_TABLES) {
    if (!(await db.schema.hasTable(name))) continue;
    const hasUpdated = await db.schema.hasColumn(name, 'updated_at');
    const row = await db(name)
      .count<{ count: string }[]>('* as count')
      .modify((q) => {
        if (hasUpdated) q.max({ max_updated: 'updated_at' });
      })
      .first();
    out[name] = {
      count: Number((row as { count: string }).count),
      maxUpdatedAt: hasUpdated ? String((row as { max_updated?: unknown }).max_updated ?? '') : null,
    };
  }
  return out;
}

describe('T-noside: printing is read-only', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: true });
  }, 180_000);
  afterAll(async () => {
    await db?.destroy();
  });

  it('issues only SELECTs, changes no watched table and publishes no event', async () => {
    const ticket = await db('tickets').select('tenant', 'ticket_id').first();
    const asset = await db('assets').select('tenant', 'asset_id').first();
    if (!ticket || !asset) {
      throw new Error('T-noside needs a seeded tenant with at least one ticket and one asset');
    }
    auth.tenant = ticket.tenant;
    const user = await db('users').where({ tenant: ticket.tenant, user_type: 'internal' }).first();
    if (!user) throw new Error('T-noside needs an internal user in the seeded tenant');

    const { printLabels } = await import('../../lib/labels/printLabels');
    const { ticketLabelViewModelProvider } = await import('@alga-psa/tickets/lib/labelViewModelProvider');
    const { assetLabelViewModelProvider } = await import('@alga-psa/assets/lib/labelViewModelProvider');
    const { getTicketLinkedAssetLabelParts } = await import('@alga-psa/assets/lib/ticketLinkedAssetLabels');
    const { resolveLabelTemplateForTenant } = await import('@alga-psa/billing/services');

    const deps = {
      providers: {
        'ticket-work-tag': ticketLabelViewModelProvider,
        'asset-identity': assetLabelViewModelProvider,
        'stock-unit-identity': undefined,
      },
      // The renderer is stubbed: the PDF step needs a browser, and it reads (tenant party) only.
      renderPdf: async () => ({ pdf: Buffer.from('%PDF'), labels: 1, sheets: 1 }),
      resolveTemplate: resolveLabelTemplateForTenant,
      getLinkedAssetParts: getTicketLinkedAssetLabelParts,
      describeClientError: () => null,
    };
    const caller = { user: user as never, tenant: ticket.tenant as string, baseUrl: 'https://psa.test' };

    const before = await snapshot();
    const statements: string[] = [];
    const listener = (query: { sql: string }) => statements.push(query.sql);
    db.on('query', listener);
    try {
      const t = await printLabels(deps as never, caller, {
        labelClass: 'ticket-work-tag', ids: [ticket.ticket_id], overrides: { title: 'Edited at print time' },
      });
      const a = await printLabels(deps as never, caller, { labelClass: 'asset-identity', ids: [asset.asset_id] });
      expect(t.ok).toBe(true);
      expect(a.ok).toBe(true);
    } finally {
      db.removeListener('query', listener);
    }
    const after = await snapshot();

    expect(statements.length).toBeGreaterThan(0);
    const writes = statements.filter((sql) => !/^\s*(select|with)\b/i.test(sql));
    expect(writes).toEqual([]);
    expect(after).toEqual(before);
    expect(published).not.toHaveBeenCalled();
  }, 120_000);
});
