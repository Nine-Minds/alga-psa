/**
 * alga-2026-0002932 — migrations 20261116070000 / 070100 / 070200.
 *
 * Runs against the migrated suite database: the table exists as the migrations
 * built it, then the data migrations are replayed over rows seeded the way PR
 * #4018 and the old engine left them, twice, to prove they are idempotent.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../test-utils/dbConfig';
import { describeWithDb } from '../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../test-utils/testDataFactory';

const require = createRequire(import.meta.url);
const createTable = require('../20261116070000_create_opportunity_evidence_citations.cjs');
const backfill = require('../20261116070100_backfill_opportunity_evidence_citations.cjs');
const clearPlaceholders = require('../20261116070200_clear_placeholder_declaration_notes.cjs');

const describeDb = await describeWithDb();

let db: Knex;
let tenant: string;
let opportunityId: string;
const ids = { activeDoc: randomUUID(), correctedInteraction: randomUUID(), system: randomUUID(), placeholder: randomUUID(), realNote: randomUUID(), systemPlaceholderText: randomUUID() };
const refs = { doc: randomUUID(), interaction: randomUUID(), quote: randomUUID() };

async function evidence(evidenceId: string) {
  return db('opportunity_evidence').where({ tenant, evidence_id: evidenceId }).first();
}
const citations = () => db('opportunity_evidence_citations').where({ tenant }).orderBy('evidence_id');

describeDb('opportunity_evidence_citations migrations', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    tenant = await createTenant(db, 'Citation Migration Tenant');
    const userId = await createUser(db, tenant, { username: 'citation.migration' });
    const clientId = await createClient(db, tenant, 'Citation Migration Client');
    opportunityId = randomUUID();
    await db('opportunities').insert({
      tenant, opportunity_id: opportunityId, opportunity_number: `OPP-${opportunityId.slice(0, 8)}`, client_id: clientId,
      title: 'Deal', opportunity_type: 'new_logo', owner_id: userId, status: 'open', stage: 'verbal', confidence: 'medium',
      mrr_cents: 0, nrr_cents: 0, hardware_cents: 0, currency_code: 'USD', values_locked_by_quote: false,
      last_activity_at: '2026-01-01T00:00:00.000Z', created_by: userId, created_at: db.fn.now(), updated_at: db.fn.now(),
    });
    const base = { tenant, opportunity_id: opportunityId, recorded_at: '2026-05-01T00:00:00.000Z' };
    await db('opportunity_evidence').insert([
      { ...base, evidence_id: ids.activeDoc, checkpoint: 'qualified', source: 'user_declared', ref_type: 'document', ref_id: refs.doc, detail: 'Has a doc' },
      { ...base, evidence_id: ids.correctedInteraction, checkpoint: 'qualified', source: 'user_declared', ref_type: 'interaction', ref_id: refs.interaction, detail: 'Old', corrected_at: '2026-05-02T00:00:00.000Z', correction_note: 'Superseded by a new declaration' },
      { ...base, evidence_id: ids.system, checkpoint: 'proposed', source: 'system', ref_type: 'quote', ref_id: refs.quote, detail: 'Quote sent' },
      { ...base, evidence_id: ids.placeholder, checkpoint: 'assessment', source: 'user_declared', detail: 'Stage manually set to assessment' },
      { ...base, evidence_id: ids.realNote, checkpoint: 'verbal', source: 'user_declared', detail: 'Stage manually set to verbal after the call' },
      // The exact placeholder text on a system row is not ours to clear.
      { ...base, evidence_id: ids.systemPlaceholderText, checkpoint: 'won', source: 'system', detail: 'Stage manually set to won' },
    ]);
  }, 180_000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, 60_000);

  it('F001: the table has the PK, unique source per declaration, ref_type CHECK and the evidence FK', async () => {
    const { rows: constraints } = await db.raw(
      `SELECT conname, contype FROM pg_constraint WHERE conrelid = 'opportunity_evidence_citations'::regclass`,
    );
    const byType = (type: string) => constraints.filter((c: any) => c.contype === type).map((c: any) => c.conname);
    expect(byType('p')).toEqual(['opportunity_evidence_citations_pkey']);
    expect(byType('u')).toEqual(['opportunity_evidence_citations_source_unique']);
    expect(byType('c')).toContain('opportunity_evidence_citations_ref_type_check');
    expect(byType('f')).toEqual(expect.arrayContaining(['opportunity_evidence_citations_evidence_fk', 'opportunity_evidence_citations_tenant_foreign']));

    await expect(db('opportunity_evidence_citations').insert({ tenant, evidence_id: ids.system, ref_type: 'quote', ref_id: refs.quote, position: 0 })).rejects.toThrow(/ref_type_check/);
    await expect(db('opportunity_evidence_citations').insert({ tenant, evidence_id: randomUUID(), ref_type: 'document', ref_id: refs.doc, position: 0 })).rejects.toThrow(/foreign key/);
  });

  it('T006: backfills the two user rows, leaves the system ref alone, clears only the exact placeholder, and is idempotent', async () => {
    const run = async () => {
      await db.transaction((trx) => backfill.up(trx));
      await db.transaction((trx) => clearPlaceholders.up(trx));
    };
    await run();
    const snapshot = async () => JSON.stringify([await citations(), await db('opportunity_evidence').where({ tenant }).orderBy('evidence_id')]);
    const afterFirst = await snapshot();

    const rows = await citations();
    expect(rows.map((r: any) => [r.evidence_id, r.ref_type, r.ref_id, r.position]).sort()).toEqual([
      [ids.activeDoc, 'document', refs.doc, 0],
      [ids.correctedInteraction, 'interaction', refs.interaction, 0],
    ].sort());

    expect(await evidence(ids.activeDoc)).toMatchObject({ ref_type: null, ref_id: null, detail: 'Has a doc' });
    expect(await evidence(ids.correctedInteraction)).toMatchObject({ ref_type: null, ref_id: null, detail: 'Old' });
    expect(await evidence(ids.system)).toMatchObject({ ref_type: 'quote', ref_id: refs.quote, detail: 'Quote sent' });
    expect((await evidence(ids.placeholder)).detail).toBeNull();
    expect((await evidence(ids.realNote)).detail).toBe('Stage manually set to verbal after the call');
    expect((await evidence(ids.systemPlaceholderText)).detail).toBe('Stage manually set to won');

    await run();
    await run();
    expect(await snapshot()).toBe(afterFirst);
  });

  it('F002: the creation migration is re-runnable (distribution is a no-op on plain Postgres)', async () => {
    await createTable.up(db);
    await createTable.up(db);
    const { rows } = await db.raw(`SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'opportunity_evidence_citations'::regclass`);
    expect(rows[0].n).toBe(5);
  });
});
