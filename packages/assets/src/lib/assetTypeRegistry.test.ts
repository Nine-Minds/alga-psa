import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  RESERVED_ASSET_TYPE_SLUGS,
  createAssetType,
  deleteAssetType,
  generateAssetTypeSlug,
  getAssetTypeBySlug,
  listAssetTypes,
  updateAssetType,
  validateFieldsSchema,
} from './assetTypeRegistry';

type Row = Record<string, any>;

type DbState = {
  asset_type_registry: Row[];
  assets: Row[];
};

let state: DbState;
let knexMock: any;
let idCounter: number;

function matches(row: Row, where: Record<string, any>): boolean {
  return Object.entries(where).every(([k, v]) => row[k] === v);
}

function createFakeKnex(db: DbState) {
  class QB {
    private whereClauses: Array<Record<string, any>> = [];
    private orderByClauses: Array<{ col: string; dir: 'asc' | 'desc' }> = [];
    private countSpec: string | null = null;

    constructor(private readonly table: keyof DbState) {}

    private get rows(): Row[] {
      return db[this.table];
    }

    where(where: Record<string, any>) {
      this.whereClauses.push(where);
      return this;
    }

    orderBy(col: string, dir: 'asc' | 'desc') {
      this.orderByClauses.push({ col, dir });
      return this;
    }

    count(spec: string) {
      this.countSpec = spec;
      return this;
    }

    private filtered(): Row[] {
      let rows = [...this.rows];
      for (const where of this.whereClauses) {
        rows = rows.filter((row) => matches(row, where));
      }
      return rows;
    }

    private sorted(rows: Row[]): Row[] {
      const clauses = this.orderByClauses;
      if (clauses.length === 0) return rows;
      return [...rows].sort((a, b) => {
        for (const { col, dir } of clauses) {
          const av = a[col];
          const bv = b[col];
          let cmp: number;
          if (typeof av === 'boolean' || typeof bv === 'boolean') {
            cmp = Number(av) - Number(bv);
          } else if (typeof av === 'number' && typeof bv === 'number') {
            cmp = av - bv;
          } else {
            cmp = String(av ?? '').localeCompare(String(bv ?? ''));
          }
          if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
        }
        return 0;
      });
    }

    first() {
      const rows = this.sorted(this.filtered());
      if (this.countSpec) {
        return Promise.resolve({ count: String(rows.length) });
      }
      return Promise.resolve(rows[0]);
    }

    insert(data: Row | Row[]) {
      const incoming = (Array.isArray(data) ? data : [data]).map((row) => ({
        type_id: `type_${++idCounter}`,
        icon: null,
        is_builtin: false,
        display_order: 0,
        fields_schema: '[]',
        created_at: new Date('2026-06-12T12:00:00.000Z'),
        updated_at: new Date('2026-06-12T12:00:00.000Z'),
        ...row,
      }));

      const hasConflict = (row: Row) =>
        this.table === 'asset_type_registry' &&
        this.rows.some((existing) => existing.tenant === row.tenant && existing.slug === row.slug);

      const insertAll = (skipConflicts: boolean): Promise<void> => {
        for (const row of incoming) {
          if (hasConflict(row)) {
            if (skipConflicts) continue;
            const error: any = new Error('duplicate key value violates unique constraint');
            error.code = '23505';
            return Promise.reject(error);
          }
          this.rows.push(row);
        }
        return Promise.resolve();
      };

      // Lazy thenable: plain `await insert(...)` inserts strictly; the
      // `.onConflict().ignore()` chain skips conflicting rows instead.
      return {
        then: (resolve: any, reject: any) => insertAll(false).then(resolve, reject),
        catch: (reject: any) => insertAll(false).catch(reject),
        onConflict: () => ({
          ignore: () => insertAll(true),
        }),
      };
    }

    update(patch: Row) {
      const rows = this.filtered();
      for (const row of rows) {
        Object.assign(row, patch);
      }
      return Promise.resolve(rows.length);
    }

    delete() {
      const remaining = this.rows.filter((row) => !this.whereClauses.every((where) => matches(row, where)));
      const removed = this.rows.length - remaining.length;
      db[this.table] = remaining as any;
      return Promise.resolve(removed);
    }

    then(resolve: (value: any) => void, reject?: (reason: unknown) => void) {
      const rows = this.sorted(this.filtered());
      if (this.countSpec) {
        return Promise.resolve([{ count: String(rows.length) }]).then(resolve, reject);
      }
      return Promise.resolve(rows).then(resolve, reject);
    }
  }

  const knex: any = (table: keyof DbState) => new QB(table);
  knex.fn = { now: () => new Date('2026-06-12T12:00:00.000Z') };
  return knex;
}

async function createCustomType(name: string, tenant = 'tenant_a', extra: Record<string, any> = {}) {
  const result = await createAssetType(knexMock, tenant, { name, ...extra });
  if (!result.ok) throw new Error(`Expected ok result, got ${JSON.stringify(result.error)}`);
  return result.value;
}

function seedBuiltin(slug: string, name: string, displayOrder: number, tenant = 'tenant_a') {
  state.asset_type_registry.push({
    tenant,
    type_id: `builtin_${slug}_${tenant}`,
    slug,
    name,
    icon: null,
    fields_schema: '[]',
    is_builtin: true,
    display_order: displayOrder,
    created_at: new Date('2026-06-12T00:00:00.000Z'),
    updated_at: new Date('2026-06-12T00:00:00.000Z'),
  });
}

beforeEach(() => {
  state = { asset_type_registry: [], assets: [] };
  knexMock = createFakeKnex(state);
  idCounter = 0;
});

describe('validateFieldsSchema (T303)', () => {
  it('accepts a valid schema covering every field kind', () => {
    const result = validateFieldsSchema([
      { key: 'hostname', label: 'Hostname', kind: 'text', required: true },
      { key: 'port_count', label: 'Port Count', kind: 'number' },
      { key: 'install_date', label: 'Install Date', kind: 'date' },
      { key: 'environment', label: 'Environment', kind: 'select', options: ['prod', 'staging'] },
      { key: 'admin_url', label: 'Admin URL', kind: 'url' },
      { key: 'monitored', label: 'Monitored', kind: 'boolean', required: false },
    ]);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.fields).toHaveLength(6);
      expect(result.fields[3]).toMatchObject({ key: 'environment', kind: 'select', options: ['prod', 'staging'] });
    }
  });

  it('rejects non-array schemas', () => {
    const result = validateFieldsSchema({ key: 'x' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues[0].code).toBe('invalid_field');
    }
  });

  it('rejects non-object entries', () => {
    const result = validateFieldsSchema(['nope']);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues).toContainEqual(expect.objectContaining({ index: 0, code: 'invalid_field' }));
    }
  });

  it('rejects bad kinds', () => {
    const result = validateFieldsSchema([{ key: 'a', label: 'A', kind: 'richtext' }]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'invalid_kind' }));
    }
  });

  it.each([
    ['uppercase', 'BadKey'],
    ['leading digit', '1abc'],
    ['dash', 'has-dash'],
    ['space', 'has space'],
    ['empty', ''],
    ['too long', `a${'b'.repeat(63)}`],
    ['missing', undefined],
  ])('rejects invalid key (%s)', (_label, key) => {
    const result = validateFieldsSchema([{ key, label: 'Label', kind: 'text' }]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'invalid_key' }));
    }
  });

  it('accepts a 63-char key (boundary)', () => {
    const result = validateFieldsSchema([{ key: `a${'b'.repeat(62)}`, label: 'Label', kind: 'text' }]);
    expect(result.valid).toBe(true);
  });

  it('rejects duplicate keys within a schema', () => {
    const result = validateFieldsSchema([
      { key: 'dup', label: 'One', kind: 'text' },
      { key: 'dup', label: 'Two', kind: 'number' },
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues).toContainEqual(expect.objectContaining({ index: 1, code: 'duplicate_key' }));
    }
  });

  it('rejects missing labels', () => {
    const result = validateFieldsSchema([{ key: 'a', label: '   ', kind: 'text' }]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'missing_label' }));
    }
  });

  it('rejects non-boolean required', () => {
    const result = validateFieldsSchema([{ key: 'a', label: 'A', kind: 'text', required: 'yes' }]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'invalid_required' }));
    }
  });

  it('rejects select without options, with empty options, and with blank option values', () => {
    for (const options of [undefined, []]) {
      const result = validateFieldsSchema([{ key: 'env', label: 'Env', kind: 'select', ...(options ? { options } : {}) }]);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.issues).toContainEqual(expect.objectContaining({ code: 'missing_options' }));
      }
    }

    const blank = validateFieldsSchema([{ key: 'env', label: 'Env', kind: 'select', options: ['ok', ' '] }]);
    expect(blank.valid).toBe(false);
    if (!blank.valid) {
      expect(blank.issues).toContainEqual(expect.objectContaining({ code: 'invalid_options' }));
    }
  });

  it('rejects options on non-select kinds', () => {
    const result = validateFieldsSchema([{ key: 'a', label: 'A', kind: 'text', options: ['x'] }]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'invalid_options' }));
    }
  });
});

describe('slug generation and conflicts (T304)', () => {
  it('generates slugs: lowercase, non-alnum to underscore, collapsed, trimmed', () => {
    expect(generateAssetTypeSlug('Door Access')).toBe('door_access');
    expect(generateAssetTypeSlug('API  Secrets!!')).toBe('api_secrets');
    expect(generateAssetTypeSlug('  Backup & DR  ')).toBe('backup_dr');
    expect(generateAssetTypeSlug('Cloud--Accounts')).toBe('cloud_accounts');
  });

  it('creates a custom type with the generated slug', async () => {
    const created = await createCustomType('Door Access', 'tenant_a', {
      icon: 'door-open',
      fields_schema: [{ key: 'badge_system', label: 'Badge System', kind: 'text' }],
    });

    expect(created).toMatchObject({
      tenant: 'tenant_a',
      slug: 'door_access',
      name: 'Door Access',
      icon: 'door-open',
      is_builtin: false,
    });
    expect(created.fields_schema).toEqual([{ key: 'badge_system', label: 'Badge System', kind: 'text' }]);
  });

  it.each(RESERVED_ASSET_TYPE_SLUGS.map((slug) => [slug]))('rejects reserved slug %s', async (slug) => {
    const name = slug.replace(/_/g, ' ');
    const result = await createAssetType(knexMock, 'tenant_a', { name });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ code: 'reserved_slug', slug });
    }
  });

  it('covers all six built-in slugs plus unknown in the reserved list', () => {
    expect([...RESERVED_ASSET_TYPE_SLUGS].sort()).toEqual(
      ['mobile_device', 'network_device', 'printer', 'server', 'unknown', 'workstation'].sort()
    );
  });

  it('returns a typed slug_conflict for a per-tenant duplicate, while other tenants stay free', async () => {
    await createCustomType('Door Access', 'tenant_a');

    const dupe = await createAssetType(knexMock, 'tenant_a', { name: 'Door  Access' });
    expect(dupe.ok).toBe(false);
    if (!dupe.ok) {
      expect(dupe.error).toEqual({ code: 'slug_conflict', slug: 'door_access' });
    }

    const otherTenant = await createAssetType(knexMock, 'tenant_b', { name: 'Door Access' });
    expect(otherTenant.ok).toBe(true);
  });

  it('rejects names that produce no usable slug', async () => {
    for (const name of ['', '   ', '###']) {
      const result = await createAssetType(knexMock, 'tenant_a', { name });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_name');
      }
    }
  });

  it('rejects creation with an invalid fields_schema', async () => {
    const result = await createAssetType(knexMock, 'tenant_a', {
      name: 'Databases',
      fields_schema: [{ key: 'Engine', label: 'Engine', kind: 'text' } as any],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_schema');
    }
  });
});

describe('listAssetTypes ordering and lookup', () => {
  it('lists built-ins first, then display_order, then name', async () => {
    seedBuiltin('workstation', 'Workstation', 0);
    seedBuiltin('unknown', 'Unknown', 5);
    await createCustomType('Zebra Printers Fleet', 'tenant_a', { display_order: 1 });
    await createCustomType('Door Access', 'tenant_a', { display_order: 1 });
    await createCustomType('Backup', 'tenant_a', { display_order: 0 });

    const listed = await listAssetTypes(knexMock, 'tenant_a');
    expect(listed.map((t) => t.slug)).toEqual([
      'workstation',
      'unknown',
      'backup',
      'door_access',
      'zebra_printers_fleet',
    ]);
  });

  it('getAssetTypeBySlug returns the mapped entry or null', async () => {
    await createCustomType('Door Access', 'tenant_a');
    const found = await getAssetTypeBySlug(knexMock, 'tenant_a', 'door_access');
    expect(found?.name).toBe('Door Access');
    expect(await getAssetTypeBySlug(knexMock, 'tenant_b', 'door_access')).toBeNull();
  });
});

describe('deleteAssetType (T305)', () => {
  it('blocks deletion with a typed in_use error while assets use the slug, then allows after re-type', async () => {
    await createCustomType('Door Access', 'tenant_a');
    state.assets.push({ tenant: 'tenant_a', asset_id: 'asset_1', asset_type: 'door_access' });

    const blocked = await deleteAssetType(knexMock, 'tenant_a', 'door_access');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.error).toEqual({ code: 'in_use', slug: 'door_access', asset_count: 1 });
    }

    state.assets[0].asset_type = 'unknown';
    const allowed = await deleteAssetType(knexMock, 'tenant_a', 'door_access');
    expect(allowed.ok).toBe(true);
    expect(await getAssetTypeBySlug(knexMock, 'tenant_a', 'door_access')).toBeNull();
  });

  it('does not count another tenant\'s assets as usage', async () => {
    await createCustomType('Door Access', 'tenant_a');
    state.assets.push({ tenant: 'tenant_b', asset_id: 'asset_1', asset_type: 'door_access' });

    const result = await deleteAssetType(knexMock, 'tenant_a', 'door_access');
    expect(result.ok).toBe(true);
  });

  it('refuses to delete built-ins', async () => {
    seedBuiltin('server', 'Server', 2);
    const result = await deleteAssetType(knexMock, 'tenant_a', 'server');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ code: 'builtin_undeletable', slug: 'server' });
    }
  });

  it('returns not_found for unknown slugs', async () => {
    const result = await deleteAssetType(knexMock, 'tenant_a', 'nope');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ code: 'not_found', slug: 'nope' });
    }
  });
});

describe('updateAssetType built-in immutability (T306)', () => {
  it('allows renaming and icon changes on built-ins', async () => {
    seedBuiltin('server', 'Server', 2);
    const result = await updateAssetType(knexMock, 'tenant_a', 'server', { name: 'Servers & VMs', icon: 'server-cog' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({ slug: 'server', name: 'Servers & VMs', icon: 'server-cog', is_builtin: true });
    }
  });

  it('rejects schema changes on built-ins with a typed error', async () => {
    seedBuiltin('server', 'Server', 2);
    const result = await updateAssetType(knexMock, 'tenant_a', 'server', {
      fields_schema: [{ key: 'cpu', label: 'CPU', kind: 'text' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ code: 'builtin_immutable', slug: 'server', attempted: ['fields_schema'] });
    }
    expect(state.asset_type_registry[0].fields_schema).toBe('[]');
  });

  it('rejects display_order changes on built-ins', async () => {
    seedBuiltin('server', 'Server', 2);
    const result = await updateAssetType(knexMock, 'tenant_a', 'server', { display_order: 9 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ code: 'builtin_immutable', attempted: ['display_order'] });
    }
  });

  it('updates schema on custom types and validates it', async () => {
    await createCustomType('Door Access', 'tenant_a');

    const updated = await updateAssetType(knexMock, 'tenant_a', 'door_access', {
      fields_schema: [{ key: 'badge_system', label: 'Badge System', kind: 'select', options: ['HID', 'Kisi'] }],
    });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.value.fields_schema).toEqual([
        { key: 'badge_system', label: 'Badge System', kind: 'select', options: ['HID', 'Kisi'] },
      ]);
      expect(updated.value.slug).toBe('door_access');
    }

    const invalid = await updateAssetType(knexMock, 'tenant_a', 'door_access', {
      fields_schema: [{ key: 'env', label: 'Env', kind: 'select' }],
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.code).toBe('invalid_schema');
    }
  });

  it('returns not_found for unknown slugs', async () => {
    const result = await updateAssetType(knexMock, 'tenant_a', 'nope', { name: 'New' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ code: 'not_found', slug: 'nope' });
    }
  });
});

describe('onboarding seed for future tenants (T302)', () => {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const seedPath = path.join(repoRoot, 'ee/server/seeds/onboarding/psa/09_asset_type_registry.cjs');

  it('hook call site: the seed file exists in the psa onboarding directory consumed by runOnboardingSeeds', () => {
    expect(existsSync(seedPath)).toBe(true);
  });

  it('seeds exactly the six built-ins for a fresh tenant and is idempotent', async () => {
    const require = createRequire(import.meta.url);
    const { seed } = require(seedPath);

    await seed(knexMock, 'tenant_new');
    await seed(knexMock, 'tenant_new');

    const rows = state.asset_type_registry.filter((row) => row.tenant === 'tenant_new');
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => [row.slug, row.name, row.display_order])).toEqual([
      ['workstation', 'Workstation', 0],
      ['network_device', 'Network Device', 1],
      ['server', 'Server', 2],
      ['mobile_device', 'Mobile Device', 3],
      ['printer', 'Printer', 4],
      ['unknown', 'Unknown', 5],
    ]);
    expect(rows.every((row) => row.is_builtin === true)).toBe(true);
    expect(rows.every((row) => row.fields_schema === '[]')).toBe(true);
  });
});
