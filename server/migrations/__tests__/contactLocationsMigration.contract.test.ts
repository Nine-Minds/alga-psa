import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const createTable = require(path.resolve(__dirname, '../20261029130000_create_contact_locations.cjs'));
const workArrangement = require(path.resolve(__dirname, '../20261029130100_add_contact_work_arrangement.cjs'));

type Recorded = { kind: string; args: unknown[] };

/**
 * A knex double that records the DDL a migration asks for. The behavioural half of these
 * guarantees is the DDL itself (PostgreSQL enforces the PK, the partial unique index and the two
 * delete rules); what can drift silently is the shape the migration emits, so that is what this
 * asserts. `probe` decides what the Citus probes in utils/citusDistribution.cjs see.
 */
function fakeKnex(probe: { citus: boolean; contactsDistributed: boolean; tableDistributed?: boolean } = {
  citus: false, contactsDistributed: false,
}) {
  const raw = vi.fn(async (statement: string, bindings?: unknown[]) => {
    const sql = String(statement);
    if (sql.includes('extname')) return { rows: [{ has_citus: probe.citus }] };
    if (sql.includes("proname = 'create_distributed_table'")) return { rows: [{ exists: probe.citus }] };
    if (sql.includes('pg_dist_partition')) {
      const target = String(bindings?.[0] ?? '');
      const distributed = target === 'contact_locations'
        ? Boolean(probe.tableDistributed)
        : probe.contactsDistributed;
      return { rows: [{ is_distributed: distributed }] };
    }
    if (sql.includes('pg_constraint')) return { rows: [{ present: false }] };
    return { rows: [] };
  });

  const columns: Recorded[] = [];
  // Column modifiers (.notNullable().defaultTo(...)) are irrelevant here: chain and return self.
  const builder = () => {
    const self: unknown = new Proxy({}, { get: () => () => self });
    return self;
  };

  const table = {
    uuid: (name: string) => { columns.push({ kind: 'uuid', args: [name] }); return builder(); },
    boolean: (name: string) => { columns.push({ kind: 'boolean', args: [name] }); return builder(); },
    text: (name: string) => { columns.push({ kind: 'text', args: [name] }); return builder(); },
    timestamp: (name: string, opts?: unknown) => { columns.push({ kind: 'timestamp', args: [name, opts] }); return builder(); },
    primary: (cols: string[]) => { columns.push({ kind: 'primary', args: [cols] }); },
    index: (...args: unknown[]) => { columns.push({ kind: 'index', args }); },
    dropColumn: (name: string) => { columns.push({ kind: 'dropColumn', args: [name] }); },
  };

  const schema = {
    hasTable: vi.fn(async () => false),
    hasColumn: vi.fn(async () => false),
    createTable: vi.fn(async (_name: string, cb: (t: typeof table) => void) => { cb(table); }),
    alterTable: vi.fn(async (_name: string, cb: (t: typeof table) => void) => { cb(table); }),
    dropTableIfExists: vi.fn(async () => undefined),
  };

  return {
    knex: { raw, schema, fn: { now: () => 'now()' } },
    raw,
    schema,
    columns,
    sql: () => raw.mock.calls.map(([statement]) => String(statement).replace(/\s+/g, ' ').trim()),
  };
}

describe('create_contact_locations migration', () => {
  it('creates the join table keyed on (tenant, contact_name_id, location_id)', async () => {
    const k = fakeKnex();
    await createTable.up(k.knex as never);

    expect(k.schema.createTable).toHaveBeenCalledWith('contact_locations', expect.any(Function));
    const names = k.columns.filter(c => c.kind !== 'primary' && c.kind !== 'index').map(c => c.args[0]);
    expect(names).toEqual(['tenant', 'contact_name_id', 'location_id', 'is_primary', 'created_at', 'created_by']);
    expect(k.columns.find(c => c.kind === 'primary')?.args[0]).toEqual(['tenant', 'contact_name_id', 'location_id']);
  });

  it('adds the partial unique primary index and the (tenant, location_id) lookup index', async () => {
    const k = fakeKnex();
    await createTable.up(k.knex as never);
    const sql = k.sql().join('\n');

    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_locations_primary ON contact_locations (tenant, contact_name_id) WHERE is_primary');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_contact_locations_location ON contact_locations (tenant, location_id)');
  });

  it('cascades from contacts and restricts deletes of a linked client_locations row', async () => {
    const k = fakeKnex();
    await createTable.up(k.knex as never);
    const sql = k.sql().join('\n');

    expect(sql).toContain(
      'ADD CONSTRAINT contact_locations_contact_foreign FOREIGN KEY (tenant, contact_name_id) ' +
      'REFERENCES contacts (tenant, contact_name_id) ON DELETE CASCADE',
    );
    expect(sql).toContain(
      'ADD CONSTRAINT contact_locations_location_foreign FOREIGN KEY (location_id, tenant) ' +
      'REFERENCES client_locations (location_id, tenant) ON DELETE RESTRICT',
    );
  });

  it('distributes by tenant co-located with contacts when contacts is distributed', async () => {
    const k = fakeKnex({ citus: true, contactsDistributed: true });
    await createTable.up(k.knex as never);

    expect(k.sql().join('\n')).toContain(
      "SELECT create_distributed_table('contact_locations', 'tenant', colocate_with => 'contacts')",
    );
  });

  it('stays local — and keeps both FKs — when contacts is not distributed', async () => {
    const k = fakeKnex({ citus: true, contactsDistributed: false });
    await createTable.up(k.knex as never);
    const sql = k.sql().join('\n');

    expect(sql).not.toContain('SELECT create_distributed_table');
    expect(sql).toContain('contact_locations_contact_foreign');
    expect(sql).toContain('contact_locations_location_foreign');
  });

  it('runs untransacted so Citus accepts create_distributed_table', () => {
    expect(createTable.config).toEqual({ transaction: false });
  });

  it('drops the table on the way down', async () => {
    const k = fakeKnex();
    await createTable.down(k.knex as never);
    expect(k.schema.dropTableIfExists).toHaveBeenCalledWith('contact_locations');
  });
});

describe('add_contact_work_arrangement migration', () => {
  it('adds a nullable text column constrained to the three arrangements', async () => {
    const k = fakeKnex();
    await workArrangement.up(k.knex as never);
    const sql = k.sql().join('\n');

    expect(k.columns.map(c => [c.kind, c.args[0]])).toContainEqual(['text', 'work_arrangement']);
    expect(sql).toContain(
      "ADD CONSTRAINT contacts_work_arrangement_check CHECK (work_arrangement IS NULL OR " +
      "work_arrangement IN ('on_site', 'hybrid', 'remote'))",
    );
  });

  it('drops the constraint before the column on the way down', async () => {
    const k = fakeKnex();
    k.schema.hasColumn.mockResolvedValue(true as never);
    await workArrangement.down(k.knex as never);

    expect(k.sql().join('\n')).toContain('DROP CONSTRAINT IF EXISTS contacts_work_arrangement_check');
    expect(k.columns.map(c => [c.kind, c.args[0]])).toContainEqual(['dropColumn', 'work_arrangement']);
  });
});
