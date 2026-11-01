import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SENSITIVE_USER_FIELDS } from '@alga-psa/types';

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const hasPermissionMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...a: any[]) => unknown) => (...args: unknown[]) =>
    fn({ user_id: 'user-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  tenantDb: (conn: any) => ({
    table: (table: string) => conn(table),
    tenantJoin: (query: any, table: string) => query.join(table),
  }),
  withTransaction: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  isAuthorizationThrow: () => false,
  permissionError: (message: string) => ({ permissionError: message }),
  actionError: (message: string) => ({ actionError: message }),
}));

vi.mock('@alga-psa/core/server', () => ({ deleteEntityWithValidation: vi.fn() }));

const TEAM = { team_id: 'team-1', team_name: 'Wizards', manager_id: 'u-lead', tenant: 'tenant-1' };
vi.mock('../../models/team', () => ({
  default: {
    getAll: async () => [TEAM],
    get: async () => TEAM,
    getMembers: async () => [
      { user_id: 'u-lead', role: 'lead' },
      { user_id: 'u-member', role: 'member' },
    ],
  },
}));

const USER_ROWS = [
  { user_id: 'u-lead', first_name: 'Glinda', last_name: 'Good', email: 'g@oz', user_type: 'internal', is_inactive: false },
  { user_id: 'u-member', first_name: 'Dorothy', last_name: 'Gale', email: 'd@oz', user_type: 'internal', is_inactive: false },
].map((r, i) => ({
  ...r,
  hashed_password: `salt:CANARYHASH${i}`,
  password: 'CANARYPLAIN',
  two_factor_secret: 'CANARY2FA',
}));

/** Fake knex: `users` honours the select list ('*' returns full rows), so credential leaks show up. */
function fakeKnex() {
  return (table: string) => {
    let cols: any[] | null = null;
    let ids: string[] | null = null;
    const b: any = {};
    b.select = (...c: any[]) => { cols = c.flat(); return b; };
    b.whereIn = (_col: string, v: string[]) => { ids = v; return b; };
    b.join = () => b;
    b.then = (res: any, rej: any) => {
      let rows: any[] = [];
      if (table === 'users') {
        rows = USER_ROWS.filter((r) => !ids || ids.includes(r.user_id));
        if (cols && !cols.includes('*')) {
          rows = rows.map((r) => Object.fromEntries(cols!.filter((c) => c in r).map((c) => [c, (r as any)[c]])) as any);
        }
      } else if (table === 'roles') {
        rows = [{ role_id: 'r1', role_name: 'Admin', user_id: 'u-lead' }];
      }
      return Promise.resolve(rows).then(res, rej);
    };
    return b;
  };
}

function walk(value: unknown, visit: (key: string | null, v: unknown) => void, key: string | null = null) {
  visit(key, value);
  if (Array.isArray(value)) value.forEach((v) => walk(v, visit));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walk(v, visit, k);
  }
}

function assertClean(result: any) {
  const keys = new Set<string>();
  const strings: string[] = [];
  walk(result, (k, v) => {
    if (k) keys.add(k);
    if (typeof v === 'string') strings.push(v);
  });
  for (const f of SENSITIVE_USER_FIELDS) expect(keys.has(f), `key ${f} leaked`).toBe(false);
  expect(strings.some((s) => s.includes('CANARY') || s.includes('salt:'))).toBe(false);
}

function assertMembers(team: any) {
  assertClean(team);
  const lead = team.members.find((m: any) => m.user_id === 'u-lead');
  const member = team.members.find((m: any) => m.user_id === 'u-member');
  expect(lead).toMatchObject({ first_name: 'Glinda', last_name: 'Good', email: 'g@oz', role: 'lead' });
  expect(lead.roles).toHaveLength(1);
  expect(member).toMatchObject({ first_name: 'Dorothy', last_name: 'Gale', email: 'd@oz', role: 'member' });
  expect(member.roles).toEqual([]);
}

describe('team member user rows carry no credentials', () => {
  beforeEach(() => {
    createTenantKnexMock.mockResolvedValue({ knex: fakeKnex() });
    hasPermissionMock.mockResolvedValue(true);
  });

  it('getTeams', async () => {
    const { getTeams } = await import('./teamActions');
    const result: any = await getTeams();
    expect(result).toHaveLength(1);
    assertMembers(result[0]);
  });

  it('getTeamById', async () => {
    const { getTeamById } = await import('./teamActions');
    assertMembers(await getTeamById('team-1'));
  });
});
