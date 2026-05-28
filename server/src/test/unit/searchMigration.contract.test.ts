import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const migrationPath = path.resolve(
  testDir,
  '../../../migrations/20260513120000_create_app_search_index.cjs',
);
const searchQueryPath = path.resolve(testDir, '../../../src/lib/search/query.ts');
const migration = require(migrationPath) as {
  up: (knex: { raw: (sql: string) => Promise<{ rows?: Array<Record<string, unknown>> }> }) => Promise<void>;
  down: (knex: { schema: { dropTableIfExists: (tableName: string) => Promise<void> } }) => Promise<void>;
};

function readSearchIndexMigration(): string {
  return readFileSync(migrationPath, 'utf8');
}

function appSearchIndexCreateTableBody(): string {
  const migration = readSearchIndexMigration();
  const tableMatch = migration.match(/CREATE TABLE app_search_index \(([\s\S]*?)\n\s*\)\s*`/);
  if (!tableMatch) {
    throw new Error('Could not find app_search_index CREATE TABLE statement');
  }

  return tableMatch[1];
}

function appSearchIndexColumnDefinitions(): Record<string, string> {
  const tableBody = appSearchIndexCreateTableBody();

  return Object.fromEntries(
    tableBody
      .split('\n')
      .map((line) => line.trim().replace(/,$/, '').replace(/\s+/g, ' '))
      .filter((line) => line.length > 0 && !line.startsWith('PRIMARY KEY'))
      .map((line) => {
        const [columnName] = line.split(' ');
        return [columnName, line];
      }),
  );
}

async function runMigrationUpWithMockedCitusState(options: {
  citusEnabled: boolean;
  alreadyDistributed?: boolean;
}): Promise<string[]> {
  const rawCalls: string[] = [];
  const knex = {
    raw: vi.fn(async (sql: string) => {
      rawCalls.push(sql);
      if (sql.includes('FROM pg_extension')) {
        return { rows: [{ enabled: options.citusEnabled }] };
      }
      if (sql.includes('FROM pg_dist_partition')) {
        return { rows: [{ is_distributed: options.alreadyDistributed ?? false }] };
      }
      return { rows: [] };
    }),
  };

  await migration.up(knex);
  return rawCalls;
}

describe('app_search_index migration contract', () => {
  it('T001 creates app_search_index with the PRD column names and SQL types', () => {
    const columns = appSearchIndexColumnDefinitions();
    const expectedColumns: Record<string, string> = {
      tenant: 'tenant uuid NOT NULL',
      object_type: 'object_type text NOT NULL',
      object_id: 'object_id text NOT NULL',
      parent_type: 'parent_type text',
      parent_id: 'parent_id text',
      title: 'title text NOT NULL',
      subtitle: 'subtitle text',
      body: 'body text',
      url: 'url text NOT NULL',
      metadata: "metadata jsonb NOT NULL DEFAULT '{}'::jsonb",
      visible_to_user_ids: "visible_to_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[]",
      visible_to_roles: "visible_to_roles text[] NOT NULL DEFAULT '{}'::text[]",
      is_internal_only: 'is_internal_only boolean NOT NULL DEFAULT false',
      is_private: 'is_private boolean NOT NULL DEFAULT false',
      client_scope_id: 'client_scope_id uuid',
      required_permission: 'required_permission text',
      search_vector: 'search_vector tsvector NOT NULL',
      search_lang: "search_lang text NOT NULL DEFAULT 'english'",
      source_updated_at: 'source_updated_at timestamptz NOT NULL',
      indexed_at: 'indexed_at timestamptz NOT NULL DEFAULT now()',
    };

    expect(Object.keys(columns)).toEqual(Object.keys(expectedColumns));
    expect(columns).toEqual(expectedColumns);
  });

  it('T002 keeps tenant non-null and uses the tenant/type/id composite primary key', () => {
    const tableBody = appSearchIndexCreateTableBody().replace(/\s+/g, ' ');
    const columns = appSearchIndexColumnDefinitions();

    expect(columns.tenant).toBe('tenant uuid NOT NULL');
    expect(tableBody).toContain('PRIMARY KEY (tenant, object_type, object_id)');
  });

  it('T003 enables pg_trgm with the idempotent extension form', () => {
    const migration = readSearchIndexMigration();

    expect(migration).toContain("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    expect(migration).not.toContain("CREATE EXTENSION pg_trgm");
  });

  it('T004 distributes app_search_index by tenant when Citus is installed', async () => {
    const rawCalls = await runMigrationUpWithMockedCitusState({ citusEnabled: true });
    const pgDistPartitionCheck = rawCalls.find((sql) => sql.includes('FROM pg_dist_partition'));

    expect(pgDistPartitionCheck).toContain("logicalrelid = 'app_search_index'::regclass");
    expect(rawCalls).toContain("SELECT create_distributed_table('app_search_index', 'tenant')");
  });

  it('T005 skips create_distributed_table when Citus is not installed', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const rawCalls = await runMigrationUpWithMockedCitusState({ citusEnabled: false });

      expect(rawCalls.some((sql) => sql.includes('FROM pg_dist_partition'))).toBe(false);
      expect(rawCalls.some((sql) => sql.includes('create_distributed_table'))).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        '[create_app_search_index] Skipping create_distributed_table (Citus extension unavailable)',
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('T006 creates a GIN index for the search_vector FTS operator used by search SQL', () => {
    const migration = readSearchIndexMigration();
    const searchQuery = readFileSync(searchQueryPath, 'utf8');

    expect(migration).toMatch(
      /CREATE INDEX app_search_index_vector_gin\s+ON app_search_index USING gin \(search_vector\)/,
    );
    expect(searchQuery).toContain('s.search_vector @@ q.tsq');
  });

  it('T007 creates a title trigram GIN index for the title fuzzy predicate used by search SQL', () => {
    const migration = readSearchIndexMigration();
    const searchQuery = readFileSync(searchQueryPath, 'utf8');

    expect(migration).toMatch(
      /CREATE INDEX app_search_index_title_trgm\s+ON app_search_index USING gin \(title gin_trgm_ops\)/,
    );
    expect(searchQuery).toContain('s.title % q.raw');
    expect(searchQuery).toContain('similarity(s.title, q.raw)');
  });

  it('T008 creates a subtitle trigram GIN index for the subtitle fuzzy predicate used by search SQL', () => {
    const migration = readSearchIndexMigration();
    const searchQuery = readFileSync(searchQueryPath, 'utf8');

    expect(migration).toMatch(
      /CREATE INDEX app_search_index_subtitle_trgm\s+ON app_search_index USING gin \(subtitle gin_trgm_ops\)/,
    );
    expect(searchQuery).toContain("coalesce(s.subtitle, '') % q.raw");
    expect(searchQuery).toContain("similarity(coalesce(s.subtitle, ''), q.raw)");
  });

  it('T009 creates tenant-scoped recent and object-type btree indexes', () => {
    const migration = readSearchIndexMigration();

    expect(migration).toMatch(
      /CREATE INDEX app_search_index_recent\s+ON app_search_index \(tenant, source_updated_at DESC\)/,
    );
    expect(migration).toMatch(
      /CREATE INDEX app_search_index_type\s+ON app_search_index \(tenant, object_type\)/,
    );
  });

  it('T010 drops app_search_index on down and allows the up path to run again', async () => {
    const dropTableIfExists = vi.fn(async () => {});

    await migration.down({
      schema: { dropTableIfExists },
    });
    const rawCalls = await runMigrationUpWithMockedCitusState({ citusEnabled: false });

    expect(dropTableIfExists).toHaveBeenCalledWith('app_search_index');
    expect(rawCalls.some((sql) => sql.includes('CREATE TABLE app_search_index'))).toBe(true);
  });

  it('T178 keeps cross-shard search co-located and GIN-indexable', () => {
    const migration = readSearchIndexMigration();
    const searchQuery = readFileSync(searchQueryPath, 'utf8');

    expect(migration).toContain("SELECT create_distributed_table('app_search_index', 'tenant')");
    expect(migration).toContain('exports.config = { transaction: false }');
    expect(migration).toMatch(/ON app_search_index USING gin \(search_vector\)/);
    expect(migration).toMatch(/ON app_search_index USING gin \(title gin_trgm_ops\)/);
    expect(migration).toMatch(/ON app_search_index USING gin \(subtitle gin_trgm_ops\)/);
    expect(searchQuery).toContain('WHERE s.tenant = ?::uuid');
    expect(searchQuery).toContain('s.search_vector @@ q.tsq');
    expect(searchQuery).toContain('s.title % q.raw');
    expect(searchQuery).toContain("coalesce(s.subtitle, '') % q.raw");
  });
});
