/**
 * Co-managed seat and workspace shapes, slice S1 (F003 / T001) on real Postgres.
 *
 * `co_managed_allocations` holds two kinds of allocation on one pool. Rows that existed before
 * the migration read as `workspace` with no data change, writers that never name the new
 * columns keep working, and the kind-aware constraints refuse a seat row that carries a
 * customer tenant and a workspace row that lacks one.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';

type Migration = { up: (knex: Knex) => Promise<void>; down: (knex: Knex) => Promise<void> };
const require = createRequire(import.meta.url);
const addKind = require('../../../migrations/20261111100000_add_co_managed_allocation_kind.cjs') as Migration;
const validateKind = require('../../../migrations/20261111100100_validate_co_managed_allocation_kind.cjs') as Migration;

const TABLE = 'co_managed_allocations';
const KIND_CHECK = 'co_managed_allocations_kind_check';
const TARGET_CHECK = 'co_managed_allocations_kind_target_check';
const LIVE_SEAT_INDEX = 'co_managed_one_live_seat_allocation';

const describeDb = await describeWithDb();

describeDb('co-managed allocation kinds on one seat pool', { shuffle: false }, () => {
  let db: Knex;

  /** The columns every allocation needs, whatever its kind. */
  const base = (tenant: string) => ({
    tenant, allocation_id: randomUUID(), operation_id: randomUUID(),
    request_fingerprint: createHash('sha256').update(randomUUID()).digest('hex'), seats: 2, state: 'active',
  });
  /** A workspace allocation exactly as code on main writes it: no kind, no sponsor client. */
  const legacyWorkspace = (tenant: string) => ({ ...base(tenant), customer_tenant: randomUUID(), relationship_id: randomUUID() });
  const seat = (tenant: string, sponsorClientId: string) => ({ ...base(tenant), allocation_kind: 'seat', sponsor_client_id: sponsorClientId });
  const read = (row: { tenant: string; allocation_id: string }) => db(TABLE).where({ tenant: row.tenant, allocation_id: row.allocation_id }).first();
  // The add half is transactional and the validate half is not, as the migration runner applies them.
  const migrateUp = async () => { await db.transaction((trx) => addKind.up(trx)); await validateKind.up(db); };
  const migrateDown = async () => { await validateKind.down(db); await db.transaction((trx) => addKind.down(trx)); };

  beforeAll(async () => { db = await createTestDbConnection({ databaseName: 's1_allocation_kind_test' }); }, 300_000);
  afterAll(async () => { await db?.destroy(); });

  it('an allocation written before the migration reads as workspace afterwards, otherwise unchanged', async () => {
    await migrateDown();
    expect(await db.schema.hasColumn(TABLE, 'allocation_kind')).toBe(false);
    const row = legacyWorkspace(randomUUID());
    await db(TABLE).insert(row);
    const before = await read(row);

    await migrateUp();
    await migrateUp(); // Idempotent: a second run changes nothing and fails nothing.

    expect(await read(row)).toEqual({ ...before, allocation_kind: 'workspace', sponsor_client_id: null });
  });

  it('leaves both kind-aware checks validated and the live-seat index valid and unique', async () => {
    const { rows: checks } = await db.raw(
      `SELECT conname, convalidated FROM pg_constraint WHERE conrelid = ?::regclass AND conname IN (?, ?) ORDER BY conname`,
      [TABLE, KIND_CHECK, TARGET_CHECK],
    );
    expect(checks).toEqual([{ conname: KIND_CHECK, convalidated: true }, { conname: TARGET_CHECK, convalidated: true }]);
    const { rows: indexes } = await db.raw(`SELECT indisvalid, indisunique FROM pg_index WHERE indexrelid = to_regclass(?)`, [LIVE_SEAT_INDEX]);
    expect(indexes).toEqual([{ indisvalid: true, indisunique: true }]);
  });

  it('a writer that names neither new column still produces a workspace allocation', async () => {
    const row = legacyWorkspace(randomUUID());
    await db(TABLE).insert(row);
    expect(await read(row)).toMatchObject({ allocation_kind: 'workspace', sponsor_client_id: null, customer_tenant: row.customer_tenant, relationship_id: row.relationship_id });
  });

  it('a workspace allocation may also record its sponsor client', async () => {
    const row = { ...legacyWorkspace(randomUUID()), sponsor_client_id: randomUUID() };
    await db(TABLE).insert(row);
    expect(await read(row)).toMatchObject({ allocation_kind: 'workspace', sponsor_client_id: row.sponsor_client_id });
  });

  it('refuses a seat allocation that carries a customer tenant or a relationship', async () => {
    const tenant = randomUUID();
    await expect(db(TABLE).insert({ ...seat(tenant, randomUUID()), customer_tenant: randomUUID() })).rejects.toThrow(TARGET_CHECK);
    await expect(db(TABLE).insert({ ...seat(tenant, randomUUID()), relationship_id: randomUUID() })).rejects.toThrow(TARGET_CHECK);
    await expect(db(TABLE).insert({ ...seat(tenant, randomUUID()), customer_tenant: randomUUID(), relationship_id: randomUUID() })).rejects.toThrow(TARGET_CHECK);
  });

  it('refuses a seat allocation without a sponsor client', async () => {
    await expect(db(TABLE).insert({ ...base(randomUUID()), allocation_kind: 'seat' })).rejects.toThrow(TARGET_CHECK);
  });

  it('refuses a workspace allocation without a customer tenant or without a relationship', async () => {
    const tenant = randomUUID();
    await expect(db(TABLE).insert({ ...base(tenant), relationship_id: randomUUID() })).rejects.toThrow(TARGET_CHECK);
    await expect(db(TABLE).insert({ ...base(tenant), customer_tenant: randomUUID() })).rejects.toThrow(TARGET_CHECK);
    await expect(db(TABLE).insert({ ...base(tenant), sponsor_client_id: randomUUID() })).rejects.toThrow(TARGET_CHECK);
  });

  it('refuses a workspace allocation whose customer is the sponsor itself, and an unknown kind', async () => {
    const tenant = randomUUID();
    await expect(db(TABLE).insert({ ...base(tenant), customer_tenant: tenant, relationship_id: randomUUID() })).rejects.toThrow(/co_managed_allocations/);
    await expect(db(TABLE).insert({ ...legacyWorkspace(tenant), allocation_kind: 'pool' })).rejects.toThrow(/co_managed_allocations_kind/);
  });

  it('allows one live seat allocation per sponsor client, and another once the first is released', async () => {
    const tenant = randomUUID(), client = randomUUID();
    const first = seat(tenant, client);
    await db(TABLE).insert(first);
    expect(await read(first)).toMatchObject({ allocation_kind: 'seat', sponsor_client_id: client, customer_tenant: null, relationship_id: null });

    await expect(db(TABLE).insert(seat(tenant, client))).rejects.toThrow(LIVE_SEAT_INDEX);
    await expect(db(TABLE).insert({ ...seat(tenant, client), state: 'reserved' })).rejects.toThrow(LIVE_SEAT_INDEX);

    // Another client of the same sponsor, and the same client id under another sponsor, are separate arrangements.
    await db(TABLE).insert(seat(tenant, randomUUID()));
    await db(TABLE).insert(seat(randomUUID(), client));

    await db(TABLE).where({ tenant, allocation_id: first.allocation_id }).update({ state: 'released', released_at: new Date() });
    const second = seat(tenant, client);
    await db(TABLE).insert(second);
    expect(await read(second)).toMatchObject({ state: 'active' });
    await expect(db(TABLE).insert(seat(tenant, client))).rejects.toThrow(LIVE_SEAT_INDEX);
  });

  it('a workspace allocation and a seat allocation for the same sponsor client coexist', async () => {
    const tenant = randomUUID(), client = randomUUID();
    await db(TABLE).insert({ ...legacyWorkspace(tenant), sponsor_client_id: client });
    await db(TABLE).insert({ ...legacyWorkspace(tenant), sponsor_client_id: client });
    await db(TABLE).insert(seat(tenant, client));
    expect(await db(TABLE).where({ tenant, sponsor_client_id: client }).whereNot('state', 'released').count('* as n').first()).toMatchObject({ n: '3' });
  });

  it('refuses to roll back while seat allocations exist', async () => {
    await expect(db.transaction((trx) => addKind.down(trx))).rejects.toThrow(/seat allocations/);
    expect(await db.schema.hasColumn(TABLE, 'allocation_kind')).toBe(true);
  });
});
