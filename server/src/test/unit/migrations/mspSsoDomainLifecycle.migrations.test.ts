import { beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../..');

const lifecycleMigration = require(
  path.resolve(repoRoot, 'server/migrations/20260303100000_add_msp_sso_domain_claim_lifecycle.cjs')
) as { up: (knex: any) => Promise<void>; down: (knex: any) => Promise<void> };

const challengeMigration = require(
  path.resolve(
    repoRoot,
    'server/migrations/20260303101000_create_msp_sso_domain_verification_challenges.cjs'
  )
) as { up: (knex: any) => Promise<void>; down: (knex: any) => Promise<void> };

const installationMetadataMigration = require(
  path.resolve(
    repoRoot,
    'server/migrations/20260303101500_create_installation_metadata_table.cjs'
  )
) as { up: (knex: any) => Promise<void>; down: (knex: any) => Promise<void> };

const backfillMigration = require(
  path.resolve(
    repoRoot,
    'server/migrations/20260303102000_backfill_msp_sso_domain_claim_status_defaults.cjs'
  )
) as { up: (knex: any) => Promise<void>; down: (knex: any) => Promise<void> };

type MigrationKnexState = {
  hasTable: Record<string, boolean>;
  hasColumn: Record<string, boolean>;
  addedColumns: string[];
  droppedColumns: string[];
  createdTables: string[];
  droppedTables: string[];
  rawSql: string[];
  challengeTableColumns: string[];
  installationMetadataRows: Array<{ key: string; value: string }>;
};

function createColumnBuilder() {
  return {
    notNullable() {
      return this;
    },
    nullable() {
      return this;
    },
    defaultTo(_value: unknown) {
      return this;
    },
    references(_value: unknown) {
      return this;
    },
    inTable(_value: unknown) {
      return this;
    },
    onDelete(_value: unknown) {
      return this;
    },
  };
}

function createMigrationKnex(state: MigrationKnexState) {
  const knexTable = (tableName: string) => {
    const builder: any = {
      select: (..._columns: string[]) => builder,
      where: (clause: Record<string, unknown>) => {
        builder.__where = clause;
        return builder;
      },
      first: async () => {
        if (tableName === 'installation_metadata') {
          const key = String((builder.__where as { key?: unknown } | undefined)?.key ?? '');
          const row = state.installationMetadataRows.find((item) => item.key === key);
          return row ? { ...row } : undefined;
        }
        return undefined;
      },
      del: async () => {
        if (tableName === 'installation_metadata') {
          const key = String((builder.__where as { key?: unknown } | undefined)?.key ?? '');
          state.installationMetadataRows = state.installationMetadataRows.filter((item) => item.key !== key);
        }
        return 0;
      },
      count: (..._args: string[]) => ({
        first: async () => ({ count: state.installationMetadataRows.length }),
      }),
    };
    return builder;
  };

  return Object.assign(knexTable, {
    fn: {
      now: () => 'now()',
    },
    raw: async (sql: string) => {
      state.rawSql.push(sql);
      if (sql.includes('FROM pg_proc')) {
        return { rows: [{ exists: false }] };
      }
      if (sql.includes('FROM pg_dist_partition')) {
        return { rows: [{ is_distributed: false }] };
      }
      return { rows: [] };
    },
    schema: {
      hasTable: async (table: string) => state.hasTable[table] ?? false,
      hasColumn: async (table: string, column: string) =>
        state.hasColumn[`${table}.${column}`] ?? false,
      alterTable: async (table: string, callback: (tableBuilder: any) => void) => {
        const tableBuilder = {
          text: (name: string) => {
            state.addedColumns.push(name);
            return createColumnBuilder();
          },
          timestamp: (name: string) => {
            state.addedColumns.push(name);
            return createColumnBuilder();
          },
          uuid: (name: string) => {
            state.addedColumns.push(name);
            return createColumnBuilder();
          },
          dropColumn: (name: string) => {
            state.droppedColumns.push(name);
          },
        };
        callback(tableBuilder);
      },
      createTable: async (table: string, callback: (tableBuilder: any) => void) => {
        state.createdTables.push(table);
        const tableBuilder = {
          uuid: (name: string) => {
            state.challengeTableColumns.push(name);
            return createColumnBuilder();
          },
          text: (name: string) => {
            state.challengeTableColumns.push(name);
            return createColumnBuilder();
          },
          boolean: (name: string) => {
            state.challengeTableColumns.push(name);
            return createColumnBuilder();
          },
          timestamp: (name: string) => {
            state.challengeTableColumns.push(name);
            return createColumnBuilder();
          },
          primary: () => tableBuilder,
          foreign: () => createColumnBuilder(),
        };
        callback(tableBuilder);
      },
      dropTableIfExists: async (table: string) => {
        state.droppedTables.push(table);
      },
    },
  });
}

describe('MSP SSO domain lifecycle migrations', () => {
  const originalEdition = process.env.EDITION;
  const originalPublicEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    if (typeof originalEdition === 'undefined') {
      delete process.env.EDITION;
    } else {
      process.env.EDITION = originalEdition;
    }
    if (typeof originalPublicEdition === 'undefined') {
      delete process.env.NEXT_PUBLIC_EDITION;
    } else {
      process.env.NEXT_PUBLIC_EDITION = originalPublicEdition;
    }
  });

  it('T001: lifecycle migration adds claim lifecycle columns and status check constraint', async () => {
    const state: MigrationKnexState = {
      hasTable: { msp_sso_tenant_login_domains: true },
      hasColumn: {},
      addedColumns: [],
      droppedColumns: [],
      createdTables: [],
      droppedTables: [],
      rawSql: [],
      challengeTableColumns: [],
      installationMetadataRows: [],
    };
    const knex = createMigrationKnex(state);

    await lifecycleMigration.up(knex);

    expect(state.addedColumns).toEqual(
      expect.arrayContaining([
        'claim_status',
        'claim_status_updated_at',
        'claim_status_updated_by',
        'claimed_at',
        'verified_at',
        'rejected_at',
        'revoked_at',
      ])
    );
    expect(state.rawSql.some((sql) => sql.includes('ADD CONSTRAINT msp_sso_tenant_login_domains_claim_status_check'))).toBe(true);
  });

  it('T002: challenge migration creates verification challenge persistence and indexes', async () => {
    const state: MigrationKnexState = {
      hasTable: { msp_sso_domain_verification_challenges: false },
      hasColumn: {},
      addedColumns: [],
      droppedColumns: [],
      createdTables: [],
      droppedTables: [],
      rawSql: [],
      challengeTableColumns: [],
      installationMetadataRows: [],
    };
    const knex = createMigrationKnex(state);

    await challengeMigration.up(knex);

    expect(state.createdTables).toContain('msp_sso_domain_verification_challenges');
    expect(state.challengeTableColumns).toEqual(
      expect.arrayContaining([
        'tenant',
        'id',
        'claim_id',
        'challenge_type',
        'challenge_label',
        'challenge_value',
        'challenge_token_hash',
        'is_active',
      ])
    );
    expect(
      state.rawSql.some((sql) =>
        sql.includes('msp_sso_domain_verification_challenges_active_claim_uniq')
      )
    ).toBe(true);
  });

  it('T003: rollback removes lifecycle additions and challenge table', async () => {
    const state: MigrationKnexState = {
      hasTable: { msp_sso_tenant_login_domains: true },
      hasColumn: {
        'msp_sso_tenant_login_domains.claim_status': true,
        'msp_sso_tenant_login_domains.claim_status_updated_at': true,
        'msp_sso_tenant_login_domains.claim_status_updated_by': true,
        'msp_sso_tenant_login_domains.claimed_at': true,
        'msp_sso_tenant_login_domains.verified_at': true,
        'msp_sso_tenant_login_domains.rejected_at': true,
        'msp_sso_tenant_login_domains.revoked_at': true,
      },
      addedColumns: [],
      droppedColumns: [],
      createdTables: [],
      droppedTables: [],
      rawSql: [],
      challengeTableColumns: [],
      installationMetadataRows: [],
    };
    const knex = createMigrationKnex(state);

    await lifecycleMigration.down(knex);
    await challengeMigration.down(knex);

    expect(state.droppedColumns).toEqual(
      expect.arrayContaining([
        'claim_status',
        'claim_status_updated_at',
        'claim_status_updated_by',
        'claimed_at',
        'verified_at',
        'rejected_at',
        'revoked_at',
      ])
    );
    expect(state.droppedTables).toContain('msp_sso_domain_verification_challenges');
  });

  it('T004: backfill marks enterprise installation claims as verified_legacy by default', async () => {
    const state: MigrationKnexState = {
      hasTable: { msp_sso_tenant_login_domains: true },
      hasColumn: { 'msp_sso_tenant_login_domains.claim_status': true },
      addedColumns: [],
      droppedColumns: [],
      createdTables: [],
      droppedTables: [],
      rawSql: [],
      challengeTableColumns: [],
      installationMetadataRows: [{ key: 'edition', value: 'enterprise' }],
    };
    const knex = createMigrationKnex(state);

    await backfillMigration.up(knex);

    expect(state.rawSql.some((sql) => sql.includes("claim_status = 'verified_legacy'"))).toBe(true);
  });

  it('T005: backfill marks community installation claims as advisory by default', async () => {
    const state: MigrationKnexState = {
      hasTable: { msp_sso_tenant_login_domains: true },
      hasColumn: { 'msp_sso_tenant_login_domains.claim_status': true },
      addedColumns: [],
      droppedColumns: [],
      createdTables: [],
      droppedTables: [],
      rawSql: [],
      challengeTableColumns: [],
      installationMetadataRows: [{ key: 'edition', value: 'community' }],
    };
    const knex = createMigrationKnex(state);

    await backfillMigration.up(knex);

    expect(state.rawSql.some((sql) => sql.includes("claim_status = 'advisory'"))).toBe(true);
  });

  it('T005: installation metadata migration creates table and seeds edition marker', async () => {
    const state: MigrationKnexState = {
      hasTable: { installation_metadata: false },
      hasColumn: {},
      addedColumns: [],
      droppedColumns: [],
      createdTables: [],
      droppedTables: [],
      rawSql: [],
      challengeTableColumns: [],
      installationMetadataRows: [],
    };
    const knex = createMigrationKnex(state);

    await installationMetadataMigration.up(knex);

    expect(state.createdTables).toContain('installation_metadata');
    expect(state.rawSql.some((sql) => sql.includes("INSERT INTO installation_metadata"))).toBe(true);
  });

  it('T004/T005 guard: backfill falls back safely to verified_legacy when marker is missing', async () => {
    const state: MigrationKnexState = {
      hasTable: { msp_sso_tenant_login_domains: true, installation_metadata: true },
      hasColumn: { 'msp_sso_tenant_login_domains.claim_status': true },
      addedColumns: [],
      droppedColumns: [],
      createdTables: [],
      droppedTables: [],
      rawSql: [],
      challengeTableColumns: [],
      installationMetadataRows: [],
    };
    const knex = createMigrationKnex(state);

    await backfillMigration.up(knex);

    expect(state.rawSql.some((sql) => sql.includes("claim_status = 'verified_legacy'"))).toBe(true);
  });
});
