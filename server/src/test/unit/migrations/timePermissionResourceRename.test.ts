/**
 * Rename of the legacy `timeentry` / `timesheet` / `timeperiod` RBAC resources.
 *
 * The rename is what lets hasPermission compare resources verbatim, so it has
 * to be lossless: a role that could reach the permission before must reach it
 * after, including roles the catalog knows nothing about.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(__dirname, '../../../../..');
const migration = require(path.join(repoRoot, 'server/migrations/20260827110000_rename_time_permission_resources.cjs'));

type Row = Record<string, any>;

function makeKnex(tables: Record<string, Row[]>) {
  const knex: any = (name: string) => {
    const filters: Row[] = [];
    const rows = () => (tables[name] ||= []);
    const matching = () => rows().filter((row) =>
      filters.every((filter) => Object.entries(filter).every(([column, value]) => row[column] === value)));

    const builder: any = {
      where(filter: Row) { filters.push(filter); return builder; },
      select(columns: string | string[]) {
        const list = Array.isArray(columns) ? columns : [columns];
        return Promise.resolve(matching().map((row) => Object.fromEntries(list.map((c) => [c, row[c]]))));
      },
      update(patch: Row) {
        const affected = matching();
        for (const row of affected) Object.assign(row, patch);
        return Promise.resolve(affected.length);
      },
      del() {
        const doomed = new Set(matching());
        tables[name] = rows().filter((row) => !doomed.has(row));
        return Promise.resolve(doomed.size);
      },
      insert(payload: Row | Row[]) {
        const incoming = Array.isArray(payload) ? payload : [payload];
        let conflict: string[] = [];
        const commit = () => {
          for (const row of incoming) {
            const clash = conflict.length > 0
              && rows().some((existing) => conflict.every((column) => existing[column] === row[column]));
            if (!clash) rows().push({ ...row });
          }
        };
        const chain: any = {
          onConflict(columns: string[]) { conflict = columns; return chain; },
          ignore() { commit(); return Promise.resolve([]); },
          then(resolve: any, reject: any) { commit(); return Promise.resolve([]).then(resolve, reject); },
        };
        return chain;
      },
    };
    return builder;
  };
  return knex;
}

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function permission(tenant: string, permission_id: string, resource: string, action: string): Row {
  return { tenant, permission_id, resource, action, msp: true, client: false };
}

describe('rename_time_permission_resources', () => {
  it('renames in place so every existing grant follows the permission', async () => {
    const tables: Record<string, Row[]> = {
      permissions: [
        permission(TENANT_A, 'p-entry', 'timeentry', 'read'),
        permission(TENANT_A, 'p-sheet', 'timesheet', 'submit'),
      ],
      role_permissions: [
        { tenant: TENANT_A, role_id: 'custom-role', permission_id: 'p-entry' },
        { tenant: TENANT_A, role_id: 'custom-role', permission_id: 'p-sheet' },
      ],
    };

    await migration.up(makeKnex(tables));

    expect(tables.permissions.map((row) => [row.permission_id, row.resource])).toEqual([
      ['p-entry', 'time_entry'],
      ['p-sheet', 'time_sheet'],
    ]);
    expect(tables.role_permissions).toHaveLength(2);
  });

  it('merges grants onto the canonical row when a tenant carries both spellings', async () => {
    const tables: Record<string, Row[]> = {
      permissions: [
        permission(TENANT_A, 'p-legacy', 'timeentry', 'read'),
        permission(TENANT_A, 'p-canonical', 'time_entry', 'read'),
      ],
      role_permissions: [
        { tenant: TENANT_A, role_id: 'role-legacy-only', permission_id: 'p-legacy' },
        { tenant: TENANT_A, role_id: 'role-both', permission_id: 'p-legacy' },
        { tenant: TENANT_A, role_id: 'role-both', permission_id: 'p-canonical' },
      ],
    };

    await migration.up(makeKnex(tables));

    expect(tables.permissions).toEqual([permission(TENANT_A, 'p-canonical', 'time_entry', 'read')]);
    // The legacy-only role keeps the permission; the role that held both does
    // not end up with a duplicate grant.
    expect(tables.role_permissions.map((row) => row.role_id).sort()).toEqual(['role-both', 'role-legacy-only']);
    expect(tables.role_permissions.every((row) => row.permission_id === 'p-canonical')).toBe(true);
  });

  it('resolves collisions per tenant', async () => {
    const tables: Record<string, Row[]> = {
      permissions: [
        permission(TENANT_A, 'a-legacy', 'timeentry', 'read'),
        permission(TENANT_A, 'a-canonical', 'time_entry', 'read'),
        permission(TENANT_B, 'b-legacy', 'timeentry', 'read'),
      ],
      role_permissions: [],
    };

    await migration.up(makeKnex(tables));

    // Tenant B has no twin, so its row is renamed rather than dropped.
    expect(tables.permissions.map((row) => row.permission_id).sort()).toEqual(['a-canonical', 'b-legacy']);
    expect(tables.permissions.every((row) => row.resource === 'time_entry')).toBe(true);
  });

  it('renames timeperiod so the v1 time-period endpoints can resolve their check', async () => {
    const tables: Record<string, Row[]> = {
      permissions: [
        permission(TENANT_A, 'p-period-read', 'timeperiod', 'read'),
        permission(TENANT_A, 'p-period-generate', 'timeperiod', 'generate'),
      ],
      role_permissions: [{ tenant: TENANT_A, role_id: 'admin', permission_id: 'p-period-read' }],
    };

    await migration.up(makeKnex(tables));

    // ApiTimeSheetController checks hasPermission(user, 'time_period', 'read');
    // nothing translated `timeperiod` for it, so the row had to move.
    expect(tables.permissions.map((row) => [row.permission_id, row.resource, row.action])).toEqual([
      ['p-period-read', 'time_period', 'read'],
      ['p-period-generate', 'time_period', 'generate'],
    ]);
    expect(tables.role_permissions).toEqual([
      { tenant: TENANT_A, role_id: 'admin', permission_id: 'p-period-read' },
    ]);
  });

  /**
   * The state main's reconciliation actually leaves behind, which makes the
   * merge branch the path every tenant takes rather than an edge case.
   *
   * The catalog 20260827091000 shipped on main carried BOTH spellings side by
   * side — `timeentry:create` next to `time_entry:create`, `timesheet:read`
   * next to `time_sheet:read`, `timeperiod:read` next to `time_period:read` —
   * so after it runs, every tenant holds a twin for eleven identities.
   */
  const MAIN_SNAPSHOT: Array<[string, string[]]> = [
    ['timeentry', ['create', 'delete', 'read', 'update']],
    ['time_entry', ['approve', 'create', 'delete', 'read', 'update']],
    ['timesheet', ['approve', 'comment', 'create', 'delete', 'read', 'read_all', 'reverse', 'submit', 'update']],
    ['time_sheet', ['approve', 'manage', 'read', 'update']],
    ['timeperiod', ['create', 'delete', 'generate', 'read', 'update']],
    ['time_period', ['create', 'delete', 'manage', 'read', 'update']],
  ];

  const canonicalName = (resource: string) =>
    (resource.startsWith('time_') ? resource : `time_${resource.slice(4)}`);

  it('merges the whole post-reconciliation fleet without losing a grant', async () => {
    const permissions: Row[] = [];
    const role_permissions: Row[] = [];
    const expected = new Set<string>();

    for (const tenant of [TENANT_A, TENANT_B]) {
      for (const [resource, actions] of MAIN_SNAPSHOT) {
        const legacy = !resource.startsWith('time_');
        for (const action of actions) {
          const id = `${tenant}-${resource}-${action}`;
          permissions.push(permission(tenant, id, resource, action));
          // Admin holds both spellings, the way the reconciliation grants them.
          role_permissions.push({ tenant, role_id: 'admin', permission_id: id });
          expected.add(`${tenant}|admin|${canonicalName(resource)}.${action}`);
          // A tenant-authored role holds only the legacy spelling: if the merge
          // dropped the row without moving the grant, this role loses access.
          if (legacy) {
            role_permissions.push({ tenant, role_id: 'custom', permission_id: id });
            expected.add(`${tenant}|custom|${canonicalName(resource)}.${action}`);
          }
        }
      }
    }

    const tables: Record<string, Row[]> = { permissions, role_permissions };
    await migration.up(makeKnex(tables));

    expect(tables.permissions.filter((row) => ['timeentry', 'timesheet', 'timeperiod'].includes(row.resource)))
      .toEqual([]);

    // Lossless: every (role, resource, action) reachable before is reachable
    // after, and no role ends up holding the same one twice.
    const byId = new Map(tables.permissions.map((row) => [row.permission_id, row]));
    const reachable = tables.role_permissions.map((grant) => {
      const target = byId.get(grant.permission_id)!;
      return `${target.tenant}|${grant.role_id}|${target.resource}.${target.action}`;
    });
    expect(reachable.length, 'a merged grant was duplicated').toBe(new Set(reachable).size);
    expect([...new Set(reachable)].sort()).toEqual([...expected].sort());
  });

  it('leaves resources that merely start with a legacy name alone', async () => {
    const tables: Record<string, Row[]> = {
      permissions: [permission(TENANT_A, 'p-settings', 'timeentry_settings', 'read')],
      role_permissions: [],
    };

    await migration.up(makeKnex(tables));

    expect(tables.permissions[0].resource).toBe('timeentry_settings');
  });

  it('restores the legacy spelling on the way down', async () => {
    const tables: Record<string, Row[]> = {
      permissions: [
        permission(TENANT_A, 'p-entry', 'timeentry', 'read'),
        permission(TENANT_A, 'p-sheet', 'timesheet', 'submit'),
      ],
      role_permissions: [],
    };
    const knex = makeKnex(tables);

    await migration.up(knex);
    await migration.down(knex);

    expect(tables.permissions.map((row) => row.resource)).toEqual(['timeentry', 'timesheet']);
  });
});
