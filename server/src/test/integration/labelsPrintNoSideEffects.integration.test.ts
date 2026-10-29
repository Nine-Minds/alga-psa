/**
 * alga-2026-0002683 C2 - T-noside: printing labels writes nothing and publishes nothing.
 *
 * Everything is real except the Puppeteer page-to-PDF step: real RBAC and record-level authorization, real
 * providers, real linked-asset query, real template resolution, and the real tenant-party + logo read path
 * of `labelPdfService` (the logo is a stored file read back through the local storage provider and inlined
 * as a data URL into the HTML that the stubbed browser receives).
 *
 * Every knex instance the code under test opens is listened on: the `knex` factory is wrapped so each
 * instance created through it (tenant pool, admin pool, connection helper) records its statements, and the
 * test's own pool points at the same throwaway database through DB_NAME_SERVER. The test FAILS if no
 * statement was observed on any of them, and fails on any statement that is not a read.
 *
 * Fixtures are seeded inside the test (labelsFixtures.ts); nothing relies on the first row of a table.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { asRequest, buildRealLabelDeps, seedLabelWorld, type LabelWorld } from './labelsFixtures';

const env = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/c2-label-storage-${process.pid}`;
  // The pools the product code opens must reach the throwaway database, never the dev 'server' one.
  process.env.DB_NAME_SERVER = process.env.TEST_DB_NAME || 'test_database';
  process.env.STORAGE_DEFAULT_PROVIDER = 'local';
  process.env.STORAGE_LOCAL_BASE_PATH = dir;
  return { dir };
});
const rec = vi.hoisted(() => ({
  on: false,
  statements: [] as Array<{ sql: string; instance: number }>,
  instances: 0,
  pages: [] as string[],
}));
const published = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: published, publishWorkflowEvent: published }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// Wrap the knex factory: every instance created anywhere gets a statement recorder.
vi.mock('knex', async (importOriginal) => {
  const actual = await importOriginal<{ default: any; knex?: any }>();
  const base = actual.default ?? actual.knex;
  const wrapped: any = (config: unknown) => {
    const instance = base(config);
    const id = ++rec.instances;
    instance.on('query', (q: { sql: string }) => {
      if (rec.on) rec.statements.push({ sql: q.sql, instance: id });
    });
    return instance;
  };
  Object.assign(wrapped, base);
  return { ...actual, default: wrapped, knex: wrapped };
});

// The ONLY stub: the browser. It receives the real HTML and returns bytes.
vi.mock('../../../../packages/billing/src/services/browserPoolService', () => ({
  browserPoolService: {
    getBrowser: async () => ({
      newPage: async () => ({
        setContent: async (html: string) => {
          rec.pages.push(html);
        },
        pdf: async () => Buffer.from('%PDF-1.4 stub'),
        close: async () => undefined,
      }),
    }),
    releaseBrowser: async () => undefined,
  },
}));

let db: Knex;
let world: LabelWorld;

const WATCHED_TABLES = [
  'stock_levels', 'stock_units', 'stock_movements', 'invoices', 'invoice_charges', 'time_entries',
  'assets', 'asset_history', 'asset_associations', 'tickets', 'documents', 'document_associations',
  'document_templates', 'document_template_assignments', 'external_files', 'audit_logs',
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

// Transaction control is not a write; everything else must be a read.
const READ_ONLY = /^\s*(select|with|begin|commit|rollback|savepoint|release|set\s+(local\s+)?(search_path|statement_timeout|app\.))/i;

// A SELECT can still write or lock: reject row locks, sequence advances, notifications and SELECT INTO.
const SELECT_WITH_EFFECT = /\bfor\s+(no\s+key\s+)?(update|share|key\s+share)\b|\bnextval\s*\(|\bsetval\s*\(|\bpg_notify\s*\(|\bselect\b[^;]*\binto\s+\w/i;

describe('T-noside: printing is read-only', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: true });
    world = await seedLabelWorld(db, env.dir);
  }, 240_000);
  afterAll(async () => {
    await db?.destroy();
    fs.rmSync(env.dir, { recursive: true, force: true });
  });

  it('issues only reads, changes no watched table and publishes no event', async () => {
    const deps = await buildRealLabelDeps();
    const { printLabels } = await import('../../lib/labels/printLabels');
    const caller = { user: world.tech, tenant: world.tenant, baseUrl: 'https://psa.test' };
    const t = world.tickets;
    const a = world.assets;

    const before = await snapshot();
    rec.statements.length = 0;
    rec.pages.length = 0;
    rec.on = true;
    let ticketBatch;
    let ticketSingle;
    let assetBatch;
    let assetSingle;
    let mixed;
    const restrictedCaller = { user: world.restricted, tenant: world.tenant, baseUrl: 'https://psa.test' };
    try {
      // Ticket batch of 3 including a ticket with a linked asset (the linked-asset query runs).
      ticketBatch = await asRequest(world.tenant, () =>
        printLabels(deps, caller, { labelClass: 'ticket-work-tag', labels: [t.a1, t.withOneAsset, t.a2].map((recordId) => ({ recordId })) })
      );
      // Single ticket with a print-time edit and an explicit linked asset choice.
      ticketSingle = await asRequest(world.tenant, () =>
        printLabels(deps, caller, {
          labelClass: 'ticket-work-tag',
          labels: [{ recordId: t.withTwoAssets, linkedAssetId: a.a3 }],
          overrides: { title: 'Edited at print time', detail: 'Edited reason' },
        })
      );
      // Asset batch of 3.
      assetBatch = await asRequest(world.tenant, () =>
        printLabels(deps, caller, { labelClass: 'asset-identity', labels: [a.a1, a.a2, a.a3].map((recordId) => ({ recordId })) })
      );
      // Single asset print.
      assetSingle = await asRequest(world.tenant, () =>
        printLabels(deps, caller, { labelClass: 'asset-identity', labels: [{ recordId: a.a2 }] })
      );
      // Mixed batch with unreadable records (record-level deny, missing, cross-tenant): skipped 3.
      mixed = await asRequest(world.tenant, () =>
        printLabels(deps, restrictedCaller, {
          labelClass: 'ticket-work-tag',
          labels: [t.a1, t.b1, '00000000-0000-4000-8000-000000000000', t.foreign, t.a2].map((recordId) => ({ recordId })),
        })
      );
    } finally {
      rec.on = false;
    }
    const after = await snapshot();

    for (const result of [ticketBatch, ticketSingle, assetBatch, assetSingle]) {
      expect(result).toMatchObject({ ok: true, skipped: 0 });
    }
    expect(mixed).toMatchObject({ ok: true, labels: 2, skipped: 3 });
    expect((ticketBatch as { labels: number }).labels).toBe(3);
    expect((assetBatch as { labels: number }).labels).toBe(3);

    // The real renderer ran: the browser stub got HTML with the real logo inlined as a data URL.
    expect(rec.pages).toHaveLength(5);
    for (const html of rec.pages) {
      expect(html).toContain('data:image/png;base64,');
    }
    // The linked asset's suffix (last 4 of an 8+ char serial) reached the batch, the full serial did not.
    expect(rec.pages[0]).toContain('TAG-A1');
    expect(rec.pages[0]).toContain('5678');
    expect(rec.pages.join('\n')).not.toContain('SN-ALPHA-12345678');

    // At least the tenant-party, logo, linked-asset and provider reads were observed...
    const sqls = rec.statements.map((s) => s.sql);
    expect(sqls.some((s) => /asset_associations/.test(s))).toBe(true);
    expect(sqls.some((s) => /tenant_companies/.test(s))).toBe(true);
    expect(sqls.some((s) => /document_associations/.test(s))).toBe(true);
    expect(sqls.some((s) => /external_files/.test(s))).toBe(true);
    expect(sqls.some((s) => /document_template_assignments/.test(s))).toBe(true);
    // ...across every knex instance the code opened, and none of it was a write.
    expect(rec.statements.length).toBeGreaterThan(0);
    const writes = rec.statements.filter((s) => !READ_ONLY.test(s.sql));
    expect(writes).toEqual([]);
    expect(rec.statements.filter((s) => SELECT_WITH_EFFECT.test(s.sql))).toEqual([]);

    expect(after).toEqual(before);
    expect(published).not.toHaveBeenCalled();
  }, 180_000);

  it('negative control: a write through each product pool (tenant, admin) is observed by the recorder', async () => {
    const { createTenantKnex, getAdminConnection } = await import('@alga-psa/db');
    const { knex: tenantPool } = await createTenantKnex(world.tenant);
    const adminPool = await getAdminConnection();
    rec.statements.length = 0;
    rec.on = true;
    try {
      await tenantPool.raw('update tickets set updated_at = updated_at where tenant = ? and ticket_id = ?', [world.tenant, world.tickets.a1]);
      await adminPool.raw('update tickets set updated_at = updated_at where tenant = ? and ticket_id = ?', [world.tenant, world.tickets.a1]);
    } finally {
      rec.on = false;
    }
    const writes = rec.statements.filter((s) => !READ_ONLY.test(s.sql));
    expect(writes).toHaveLength(2);
    expect(new Set(writes.map((w) => w.instance)).size).toBe(2); // two different pools, both listened on
  });

  it('the harness pool and the product pools are the throwaway database', async () => {
    const { rows } = await db.raw('select current_database() as name');
    expect(rows[0].name).toBe(process.env.TEST_DB_NAME || 'test_database');
    expect(process.env.DB_NAME_SERVER).toBe(rows[0].name);
    expect(os.tmpdir()).toBeTruthy();
    expect(path.isAbsolute(env.dir)).toBe(true);
  });
});
