/**
 * Migration regression test for the 20260812110000 down path (Defect 2).
 *
 * The down path must never destroy Hudu-ref or non-asset association rows: the
 * migration runs WITHOUT a transaction (config.transaction = false — Citus DDL
 * compatibility), so `down` uses a PREFLIGHT-ABORT — it counts
 * unrepresentable rows first and throws before any DDL. This suite proves:
 *
 *  - a `down` with a Hudu-ref row (`credential_ref` set, `credential_id` NULL)
 *    throws and leaves the schema AND data fully intact;
 *  - a `down` with a non-asset `entity_type` row (same failure class) throws
 *    and leaves schema AND data fully intact;
 *  - a `down` with only representable rows succeeds and fully reverts.
 *
 * Runs against an ISOLATED throwaway database bootstrapped by the full CE
 * migration chain (the established harness pattern — see
 * scripts/bootstrap-playwright-db.ts) and dropped by this suite — never the
 * shared dev DB, which other worktrees share.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import knexFactory, { type Knex } from 'knex';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { config as loadDotEnv } from 'dotenv';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(process.cwd(), '..', '..');

// Load the wired-in dev DB connection (server/.env.local) into the test env,
// matching the credentials integration suite.
loadDotEnv({ path: path.join(repoRoot, 'server', '.env.local'), override: true });

function readPostgresPassword(): string {
  try {
    return fs.readFileSync(path.join(repoRoot, 'secrets', 'postgres_password'), 'utf8').trim();
  } catch {
    return process.env.DB_PASSWORD_ADMIN || 'postpass123';
  }
}

// Direct postgres only (NOT pgbouncer): CREATE/DROP DATABASE and the Citus-style
// DDL under test need a real postgres connection — pgbouncer rejects new
// roles/databases.
const POSTGRES_PORT = 5472;

function connectTo(database: string): Knex {
  return knexFactory({
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || '127.0.0.1',
      port: POSTGRES_PORT,
      user: process.env.DB_USER_ADMIN || 'postgres',
      password: readPostgresPassword(),
      database,
    },
    pool: { min: 1, max: 5 },
  });
}

/** Same directory-based migration source the bootstrap harness uses. */
class DirectoryMigrationSource {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  async getMigrations(loadExtensions?: string[]): Promise<string[]> {
    const exts = loadExtensions && loadExtensions.length > 0 ? loadExtensions : ['.cjs', '.js'];
    const extSet = new Set(exts.map((e) => (e.startsWith('.') ? e : `.${e}`)));
    const files = await fsp.readdir(this.directory).catch(() => [] as string[]);
    return files
      .filter((file) => extSet.has(path.extname(file)))
      .map((file) => path.join(this.directory, file))
      .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  }

  getMigrationName(migration: string): string {
    return path.basename(migration);
  }

  getMigration(migration: string): unknown {
    return require(migration);
  }
}

const expandMigration = require(
  path.resolve(repoRoot, 'server', 'migrations', '20260812110000_expand_credential_associations_entity_types.cjs')
) as {
  up: (knex: Knex) => Promise<void>;
  down: (knex: Knex) => Promise<void>;
};

describe('credentials associations expand migration — down preflight-abort (isolated DB)', () => {
  const HOOK_TIMEOUT = 180_000;

  let admin: Knex;
  let db: Knex;
  let db2: Knex;
  let dbName: string;
  let tenantId: string;
  let clientId: string;
  let userId: string;
  let credentialId: string;
  let assetId: string;

  beforeAll(async () => {
    admin = connectTo('postgres');
    dbName = `credentials_migration_test_${randomUUID().slice(0, 8)}`;
    await admin.raw(`CREATE DATABASE "${dbName}"`);
    db = connectTo(dbName);
    db2 = connectTo(dbName);
    await db.raw('select 1');

    // Bootstrap the full CE migration chain so all prerequisite tables (tenants,
    // clients, users, assets, ...) and the credential tables exist in the
    // expanded (post-up) state — the same harness the playwright DB bootstrap
    // uses.
    const migrationsDir = path.resolve(repoRoot, 'server', 'migrations');
    await db.migrate.latest({ migrationSource: new DirectoryMigrationSource(migrationsDir) as never });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db2?.destroy().catch(() => undefined);
    await db?.destroy().catch(() => undefined);
    await admin?.raw(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`).catch(() => undefined);
    await admin?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  /**
   * A refused down leaves the schema fully migrated, so tests 1/2 never need a
   * reset. A successful down (test 3) reverts the schema; this repairs it by
   * re-running only the expand up (idempotent against the pre-expansion shape).
   */
  async function ensureMigrated(): Promise<void> {
    if (!(await db.schema.hasColumn('credential_associations', 'credential_ref'))) {
      await expandMigration.up(db);
    }
  }

  /** Each test starts from an empty association table (the DB is throwaway). */
  async function clearAssociations(): Promise<void> {
    await db('credential_associations').del();
  }

  /** Seed the minimal FK chain (tenant -> client/user -> credential/asset). */
  async function seedParentFixtures(): Promise<void> {
    tenantId = randomUUID();
    await db('tenants').insert({
      tenant: tenantId,
      client_name: 'Migration Test Tenant',
      email: `mig-it-${tenantId}@example.test`,
    });
    const [client] = await db('clients').insert({ tenant: tenantId, client_name: 'Mig Client' }).returning('client_id');
    clientId = client.client_id;
    const [user] = await db('users')
      .insert({
        tenant: tenantId,
        username: `mig-user-${randomUUID().slice(0, 8)}`,
        email: `mig-user-${tenantId}@example.test`,
        hashed_password: 'hashed_password_here',
        is_inactive: false,
        user_type: 'internal',
      })
      .returning('user_id');
    userId = user.user_id;
    const [cred] = await db('credentials')
      .insert({
        tenant: tenantId,
        client_id: clientId,
        name: 'Mig Credential',
        password_ciphertext: 'enc:noop',
        otp_secret_ciphertext: null,
        encryption_scheme: 'aes-256-gcm:v1',
        is_restricted: false,
        created_by: userId,
      })
      .returning('credential_id');
    credentialId = cred.credential_id;
    const [asset] = await db('assets')
      .insert({
        tenant: tenantId,
        asset_tag: `MIG-${randomUUID().slice(0, 8)}`,
        name: 'Mig Asset',
        status: 'active',
        client_id: clientId,
      })
      .returning('asset_id');
    assetId = asset.asset_id;
  }

  async function constraintDef(name: string): Promise<string | null> {
    const res = await db.raw(
      'SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ?',
      [name]
    );
    return res.rows[0]?.def ?? null;
  }

  async function indexExists(name: string): Promise<boolean> {
    const res = await db.raw(
      'SELECT count(*) AS c FROM pg_indexes WHERE indexname = ?',
      [name]
    );
    return Number(res.rows[0]?.c ?? 0) > 0;
  }

  async function columnNullable(column: string): Promise<boolean> {
    const res = await db.raw(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'credential_associations' AND column_name = ?`,
      [column]
    );
    return res.rows[0]?.is_nullable === 'YES';
  }

  /** All expanded-schema surfaces must be present and untouched. */
  async function expectFullyMigratedSchemaAndRows(rowCount: number): Promise<void> {
    expect(await db.schema.hasColumn('credential_associations', 'credential_ref')).toBe(true);
    expect(await columnNullable('credential_id')).toBe(true);
    expect(await constraintDef('credential_associations_oneof_ref_check')).toContain('credential_id IS NOT NULL');
    expect(await constraintDef('credential_associations_ref_shape_check')).toContain('^hudu:');
    expect(await constraintDef('credential_associations_entity_type_check')).toContain("'ticket'");
    expect(await indexExists('credential_associations_credential_entity_unique')).toBe(true);
    expect(await indexExists('credential_associations_ref_entity_unique')).toBe(true);
    const rows = await db('credential_associations').select('credential_id', 'credential_ref', 'entity_type');
    expect(rows).toHaveLength(rowCount);
  }

  it('down REFUSES (throws) and leaves schema/data fully intact when a Hudu-ref row exists', async () => {
    await ensureMigrated();
    await clearAssociations();
    await seedParentFixtures();
    // Representable row: a real asset association (credential_id set).
    await db('credential_associations').insert({
      tenant: tenantId,
      credential_id: credentialId,
      entity_id: assetId,
      entity_type: 'asset',
    });
    // Unrepresentable row: external Hudu ref, credential_id NULL.
    await db('credential_associations').insert({
      tenant: tenantId,
      credential_id: null,
      credential_ref: 'hudu:5:42',
      entity_id: assetId,
      entity_type: 'asset',
    });

    await expect(expandMigration.down(db)).rejects.toThrow(
      /Refusing to roll back 20260812110000.*1 row\(s\) with credential_ref set/
    );

    await expectFullyMigratedSchemaAndRows(2);
  });

  it('down REFUSES (throws) and leaves schema/data fully intact when a non-asset entity_type row exists', async () => {
    await ensureMigrated();
    await clearAssociations();
    await seedParentFixtures();
    await db('credential_associations').insert({
      tenant: tenantId,
      credential_id: credentialId,
      entity_id: assetId,
      entity_type: 'asset',
    });
    // Unrepresentable row: entity_type beyond the pre-expansion roster.
    await db('credential_associations').insert({
      tenant: tenantId,
      credential_id: credentialId,
      entity_id: randomUUID(),
      entity_type: 'ticket',
    });

    await expect(expandMigration.down(db)).rejects.toThrow(
      /Refusing to roll back 20260812110000.*1 row\(s\) with entity_type <> 'asset'/
    );

    await expectFullyMigratedSchemaAndRows(2);
  });

  it('down succeeds when only representable rows exist and fully reverts the schema', async () => {
    await ensureMigrated();
    await clearAssociations();
    await seedParentFixtures();
    await db('credential_associations').insert({
      tenant: tenantId,
      credential_id: credentialId,
      entity_id: assetId,
      entity_type: 'asset',
    });

    await expandMigration.down(db);

    // Schema fully reverted to pre-expansion.
    expect(await db.schema.hasColumn('credential_associations', 'credential_ref')).toBe(false);
    expect(await columnNullable('credential_id')).toBe(false);
    expect(await constraintDef('credential_associations_oneof_ref_check')).toBeNull();
    expect(await constraintDef('credential_associations_ref_shape_check')).toBeNull();
    expect(await constraintDef('credential_associations_entity_type_check')).toBe(
      "CHECK ((entity_type = 'asset'::text))"
    );
    expect(await constraintDef('credential_associations_credential_entity_unique')).toContain(
      'UNIQUE (tenant, credential_id, entity_id, entity_type)'
    );
    expect(await indexExists('credential_associations_ref_entity_unique')).toBe(false);
    // The full unique constraint's backing index carries the constraint name.
    expect(await indexExists('credential_associations_credential_entity_unique')).toBe(true);

    // The representable row survived the downgrade untouched (credential_ref is
    // gone, so the select uses only pre-expansion columns).
    const rows = await db('credential_associations').select('credential_id', 'entity_type');
    expect(rows).toEqual([{ credential_id: credentialId, entity_type: 'asset' }]);
  });

  it('down ATOMIC preflight: the count runs under an ACCESS EXCLUSIVE lock, so a concurrent ref write is never silently absorbed', async () => {
    await ensureMigrated();
    await clearAssociations();
    await seedParentFixtures();
    await db('credential_associations').insert({
      tenant: tenantId,
      credential_id: credentialId,
      entity_id: assetId,
      entity_type: 'asset',
    });

    // Gate the table with a SHARE UPDATE EXCLUSIVE lock the test holds: SUE
    // conflicts with ACCESS EXCLUSIVE (the fixed down's explicit preflight lock
    // AND every DDL lock) but is compatible with plain SELECT, so it does NOT
    // block the pre-fix count — it only blocks the pre-fix down at its FIRST
    // DDL, AFTER the count already ran.
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let gateError: unknown = null;
    const holder = db
      .transaction(async (trx) => {
        await trx.raw('LOCK TABLE credential_associations IN SHARE UPDATE EXCLUSIVE MODE');
        await gate;
      })
      .catch((error: unknown) => {
        gateError = error;
      });

    try {
      const downPromise = expandMigration.down(db);

      // The fixed down blocks at its PREFLIGHT lock (its first statement),
      // BEFORE the count runs. Pre-fix down never issues a LOCK TABLE, so this
      // observation cannot match: the pre-fix down is gated only at its first
      // DDL, after an unlocked count. The atomicity of the preflight is exactly
      // what the fix adds.
      const preflightLockObserved = await waitForDownPreflightLock();

      // Concurrent ref-only write on a SEPARATE connection. While down is
      // gated at its preflight lock, Postgres's lock queue blocks this write
      // until down finishes; it then lands on the narrowed schema and is
      // rejected — it is never silently absorbed by DROP COLUMN. Start it as a
      // promise (it stays queued) and await it AFTER down has completed.
      const insertOutcomeP = db2('credential_associations')
        .insert({
          tenant: tenantId,
          credential_id: null,
          credential_ref: 'hudu:5:99',
          entity_id: assetId,
          entity_type: 'asset',
        })
        .then(() => 'committed' as const, () => 'rejected' as const);

      releaseGate();
      await holder;
      expect(gateError).toBeNull();
      expect(preflightLockObserved).toBe(true);

      // The race has exactly two FAIL-CLOSED outcomes, and which one occurs is
      // a genuine scheduling matter (whether the concurrent INSERT's request
      // reaches the server before or after down's guard DDL). Both must be
      // accepted — the invariant under test is that a ref-only row is never
      // SILENTLY dropped, never absorbed by the credential_ref DROP COLUMN:
      //   (a) down succeeds   => guard 1 (SET NOT NULL) won the race, the
      //       concurrent insert is REJECTED against the narrowed schema, the
      //       column is gone, only the representable row remains; or
      //   (b) the insert lands => guard 1 fails, down is REFUSED, the ref-only
      //       row and the credential_ref column both survive untouched.
      let downRefused = false;
      try {
        await downPromise;
      } catch {
        downRefused = true;
      }
      const insertOutcome = await insertOutcomeP;

      if (insertOutcome === 'rejected') {
        expect(downRefused).toBe(false);
        expect(await db.schema.hasColumn('credential_associations', 'credential_ref')).toBe(false);
        const rows = await db('credential_associations').select('credential_id', 'entity_type');
        expect(rows).toEqual([{ credential_id: credentialId, entity_type: 'asset' }]);
      } else {
        expect(insertOutcome).toBe('committed');
        // The concurrent write was NOT silently destroyed: the down must have
        // been refused by a guard BEFORE the destructive drop, and the ref-only
        // row (plus its column) must still be there.
        expect(downRefused).toBe(true);
        expect(await db.schema.hasColumn('credential_associations', 'credential_ref')).toBe(true);
        const rows = await db('credential_associations').select('credential_id', 'credential_ref', 'entity_type');
        expect(rows).toContainEqual({ credential_id: null, credential_ref: 'hudu:5:99', entity_type: 'asset' });
      }
    } finally {
      releaseGate();
      await holder;
    }
  });

  /** Poll pg_stat_activity until the down connection is waiting on the preflight LOCK TABLE. */
  async function waitForDownPreflightLock(timeoutMs = 10_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    const probeSql = `
      SELECT count(*)::int AS c
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND state = 'active'
        AND wait_event_type = 'Lock'
        AND query ILIKE '%LOCK TABLE credential_associations IN ACCESS EXCLUSIVE MODE%';
    `;
    while (Date.now() < deadline) {
      const result = await db.raw(probeSql);
      if (Number(result.rows?.[0]?.c ?? 0) > 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  }
});
