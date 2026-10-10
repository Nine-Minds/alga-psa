import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../test-utils/dbConfig';

const require = createRequire(import.meta.url);
const MIGRATIONS_DIR = path.resolve(__dirname, '..');
const BACKFILL_NAME = '20261010100000_backfill_quote_converted_contract_lines.cjs';
const DB_NAME = 'test_db_quote_converted_backfill';
const tenant = randomUUID();
const ids = {
  quoteDraftAllInactive: randomUUID(),
  quoteActiveAllInactive: randomUUID(),
  quotePartial: randomUUID(),
  plainDraft: randomUUID(),
};
let db: Knex;
let scratchMigrationsDir: string;
let scratchSeedsDir: string;

beforeAll(async () => {
  wireLocalTestDbEnv();
  scratchMigrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-backfill-migrations-'));
  scratchSeedsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-backfill-seeds-'));
  const quote = JSON.stringify({ conversion_kind: 'quote_to_contract' });
  const line = (contract: string, active: boolean) =>
    `{ tenant, contract_line_id: '${randomUUID()}', contract_id: '${contract}', is_active: ${active} }`;
  const cc = (contract: string) =>
    `{ tenant, client_contract_id: '${randomUUID()}', contract_id: '${contract}', is_active: true }`;
  fs.writeFileSync(path.join(scratchMigrationsDir, '20261010110000_qc_fixture_tables.cjs'), `exports.up = async (knex) => {
    await knex.schema.createTable('contracts', t => {
      t.uuid('tenant').notNullable(); t.uuid('contract_id').notNullable();
      t.text('status'); t.jsonb('template_metadata'); t.primary(['tenant', 'contract_id']);
    });
    await knex.schema.createTable('contract_lines', t => {
      t.uuid('tenant').notNullable(); t.uuid('contract_line_id').notNullable(); t.uuid('contract_id').notNullable();
      t.boolean('is_active').notNullable(); t.timestamp('updated_at'); t.primary(['tenant', 'contract_line_id']);
    });
    await knex.schema.createTable('client_contracts', t => {
      t.uuid('tenant').notNullable(); t.uuid('client_contract_id').notNullable(); t.uuid('contract_id').notNullable();
      t.boolean('is_active').notNullable(); t.timestamp('updated_at'); t.primary(['tenant', 'client_contract_id']);
    });
    const tenant = ${JSON.stringify(tenant)};
    const quote = ${quote};
    await knex('contracts').insert([
      { tenant, contract_id: '${ids.quoteDraftAllInactive}', status: 'draft', template_metadata: quote },
      { tenant, contract_id: '${ids.quoteActiveAllInactive}', status: 'active', template_metadata: quote },
      { tenant, contract_id: '${ids.quotePartial}', status: 'draft', template_metadata: quote },
      { tenant, contract_id: '${ids.plainDraft}', status: 'draft', template_metadata: null },
    ]);
    await knex('contract_lines').insert([
      ${line(ids.quoteDraftAllInactive, false)}, ${line(ids.quoteDraftAllInactive, false)},
      ${line(ids.quoteActiveAllInactive, false)},
      ${line(ids.quotePartial, false)}, ${line(ids.quotePartial, true)},
      ${line(ids.plainDraft, false)},
    ]);
    await knex('client_contracts').insert([
      ${cc(ids.quoteDraftAllInactive)}, ${cc(ids.quoteActiveAllInactive)}, ${cc(ids.quotePartial)}, ${cc(ids.plainDraft)},
    ]);
  };
  exports.down = async knex => {
    for (const t of ['client_contracts', 'contract_lines', 'contracts']) await knex.schema.dropTableIfExists(t);
  };
`);
  fs.writeFileSync(
    path.join(scratchMigrationsDir, BACKFILL_NAME),
    `module.exports = require(${JSON.stringify(path.join(MIGRATIONS_DIR, BACKFILL_NAME))});\n`,
  );
  db = await createTestDbConnection({ databaseName: DB_NAME, migrationsDir: scratchMigrationsDir, seedsDir: scratchSeedsDir, runSeeds: false });
}, 300_000);

afterAll(async () => {
  await db?.destroy().catch(() => undefined);
  if (scratchMigrationsDir) fs.rmSync(scratchMigrationsDir, { recursive: true, force: true });
  if (scratchSeedsDir) fs.rmSync(scratchSeedsDir, { recursive: true, force: true });
});

const lineStates = async (contractId: string) =>
  (await db('contract_lines').where({ tenant, contract_id: contractId }).select('is_active')).map((r: any) => r.is_active);
const ccActive = async (contractId: string) =>
  (await db('client_contracts').where({ tenant, contract_id: contractId }).first()).is_active;

describe('quote-converted contract line backfill', () => {
  it('activates lines of quote contracts whose lines are all inactive', async () => {
    expect(await lineStates(ids.quoteDraftAllInactive)).toEqual([true, true]);
    expect(await lineStates(ids.quoteActiveAllInactive)).toEqual([true]);
  });

  it('leaves a partially inactive quote contract and non-quote contracts untouched', async () => {
    expect((await lineStates(ids.quotePartial)).sort()).toEqual([false, true]);
    expect(await lineStates(ids.plainDraft)).toEqual([false]);
  });

  it('sets client_contracts.is_active=false only on quote-converted draft headers', async () => {
    expect(await ccActive(ids.quoteDraftAllInactive)).toBe(false);
    expect(await ccActive(ids.quotePartial)).toBe(false);
    expect(await ccActive(ids.quoteActiveAllInactive)).toBe(true);
    expect(await ccActive(ids.plainDraft)).toBe(true);
  });

  it('is idempotent and has a no-op down', async () => {
    const migration = require(path.join(MIGRATIONS_DIR, BACKFILL_NAME));
    await migration.up(db);
    await migration.down(db);
    expect(await lineStates(ids.quoteDraftAllInactive)).toEqual([true, true]);
  });
});
