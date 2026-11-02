/**
 * One table of admission cases drives every internal-user creation path
 * (addUser server action, UserService.create for the API) through the shared
 * admission primitive, so a path that skips the co-managed gate fails here.
 *
 * The database is an in-memory transactional fake (no Postgres needed); the
 * co-managed gate itself is stubbed per case and has its own suite in
 * packages/licensing (co-managed-admission.test.ts). What these tests pin is
 * the wiring: the gate runs on the insert transaction, a co-managed result is
 * final (the static licensed_user_count is ignored), and a refusal leaves no
 * user or user_roles rows behind.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const world = vi.hoisted(() => ({
  state: { users: [] as Row[], user_roles: [] as Row[] },
  tenantRow: { licensed_user_count: null as number | null, plan: 'pro', product_code: 'psa' },
  usedInternalUsers: 0,
  failRoleInsert: false,
  nextTrxId: 0,
  gateCalls: [] as Array<{ trxId: number; input: Row }>,
  writes: [] as Array<{ table: string; trxId: number }>,
  gate: null as null | ((input: Row) => any),
}));

vi.mock('@alga-psa/licensing', () => {
  class CoManagedAdmissionError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = 'CoManagedAdmissionError';
    }
  }
  return {
    CoManagedAdmissionError,
    assertCoManagedSeatAdmission: async (trx: any, _tenant: string, input: Row) => {
      world.gateCalls.push({ trxId: trx.__id, input });
      return world.gate ? world.gate(input) : { managed: false };
    },
  };
});

function makeTrx() {
  const id = ++world.nextTrxId;
  const write = (table: string) => world.writes.push({ table, trxId: id });
  const table = (name: string): any => {
    if (name === 'tenants') {
      return { first: async () => world.tenantRow };
    }
    if (name === 'roles') {
      const role = { role_id: 'role-1', client: false, msp: true };
      return {
        where: () => ({ first: async () => role }),
        whereIn: () => ({ select: async () => [role] }),
      };
    }
    if (name === 'users') {
      return {
        where: () => ({
          count: async () => [{ count: String(world.usedInternalUsers) }],
          select: () => ({ first: async () => world.state.users[0] }),
        }),
        insert: (values: Row) => ({
          returning: async () => {
            write('users');
            const row = { user_id: 'new-user', ...values };
            world.state.users.push(row);
            return [row];
          },
        }),
      };
    }
    if (name === 'user_roles') {
      return {
        insert: async (values: Row | Row[]) => {
          if (world.failRoleInsert) throw new Error('user_roles insert failed');
          write('user_roles');
          world.state.user_roles.push(...(Array.isArray(values) ? values : [values]));
          return [];
        },
      };
    }
    throw new Error(`Unexpected tenant table ${name}`);
  };
  const trx: any = (name: string) => table(name);
  trx.table = table;
  trx.__id = id;
  trx.isTransaction = true;
  trx.fn = { now: () => 'now()' };
  trx.raw = (s: string) => s;
  return trx;
}

// Commit on success, restore the snapshot on throw: the rollback the real
// transaction gives the callers.
async function runTransaction<T>(cb: (trx: any) => Promise<T>): Promise<T> {
  const snapshot = { users: [...world.state.users], user_roles: [...world.state.user_roles] };
  try {
    return await cb(makeTrx());
  } catch (error) {
    world.state.users = snapshot.users;
    world.state.user_roles = snapshot.user_roles;
    throw error;
  }
}

vi.mock('@alga-psa/core', () => ({
  isEnterprise: false,
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('@alga-psa/core/server', () => ({ deleteEntityWithValidation: vi.fn() }));
vi.mock('@alga-psa/core/encryption', () => ({
  hashPassword: async () => 'hashed-password',
  verifyPassword: vi.fn(),
}));
vi.mock('@alga-psa/core/logger', () => ({
  default: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...args: any[]) => any) => (...args: any[]) => fn(...args),
  withOptionalAuth: (fn: (...args: any[]) => any) => fn,
  verifyAuthenticator: vi.fn(),
}));
vi.mock('@alga-psa/db', () => {
  class BaseService {
    protected async getKnex() {
      return { knex: {}, tenant: 'tenant-1' };
    }
    protected async ensurePermission() {}
    protected buildTenantScopedQuery() {
      const chain: any = { andWhere: () => chain, where: () => chain, select: () => chain, first: async () => undefined };
      return chain;
    }
  }
  return {
    BaseService,
    createTenantKnex: async () => ({ knex: {}, tenant: 'tenant-1' }),
    withTransaction: (_db: unknown, cb: (trx: any) => Promise<any>) => runTransaction(cb),
    withAdminTransaction: vi.fn(),
    validateSystemContext: vi.fn(),
    tenantDb: (conn: any, _tenant: string) => ({
      table: (t: string) => conn(t),
      // Only the global email-uniqueness lookup is unscoped: no existing user.
      unscoped: () => ({
        where: () => ({ whereNot: () => ({ first: async () => null }), first: async () => null }),
      }),
    }),
  };
});
vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => (() => ({
    where: () => ({ whereNot: () => ({ first: async () => null }), first: async () => null }),
  })),
}));
vi.mock('@alga-psa/db/models/user', () => ({
  default: { update: vi.fn(), getUserWithRoles: vi.fn(), getUserRoles: async () => [], isInReportsToChain: vi.fn() },
}));
vi.mock('@alga-psa/db/models/userPreferences', () => ({ default: { upsert: async () => undefined } }));
vi.mock('@alga-psa/user-composition/lib/permissions', () => ({
  hasPermission: async () => true,
  throwPermissionError: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishNonCatalogWorkflowEvent: async () => undefined }));
vi.mock('@alga-psa/storage', () => ({ uploadEntityImage: vi.fn(), deleteEntityImage: vi.fn() }));
vi.mock('@alga-psa/formatting/avatarUtils', () => ({ getUserAvatarUrl: vi.fn() }));
vi.mock('@alga-psa/user-composition/lib/avatarUtils', () => ({ getUserAvatarUrl: vi.fn() }));
vi.mock('@alga-psa/teams/models/team', () => ({ default: {} }));

import { CoManagedAdmissionError } from '@alga-psa/licensing';

const refuse = (code: string) => () => {
  throw new CoManagedAdmissionError(code as any);
};

type Case = {
  name: string;
  tenantRow?: Partial<typeof world.tenantRow>;
  used?: number;
  gate?: (input: Row) => any;
  /** The refusal code, or null when the user must be created. */
  expected: string | null;
};

// licensed_user_count is deliberately stale-high (10) for the refusal cases: the
// old static check would have let every one of them through.
const CASES: Case[] = [
  {
    name: 'lapsed sponsor entitlement with a stale licensed_user_count',
    tenantRow: { product_code: 'co_managed', licensed_user_count: 10 },
    used: 1,
    gate: refuse('CO_MANAGED_LICENSE_LAPSED'),
    expected: 'CO_MANAGED_LICENSE_LAPSED',
  },
  {
    name: 'inactive relationship',
    tenantRow: { product_code: 'co_managed', licensed_user_count: 10 },
    used: 1,
    gate: refuse('CO_MANAGED_NOT_ACTIVE'),
    expected: 'CO_MANAGED_NOT_ACTIVE',
  },
  {
    name: 'allocated seats exhausted',
    tenantRow: { product_code: 'co_managed', licensed_user_count: 10 },
    used: 3,
    gate: refuse('CO_MANAGED_SEAT_LIMIT'),
    expected: 'CO_MANAGED_SEAT_LIMIT',
  },
  {
    // The static count (1) is already reached: a managed result must be final.
    name: 'active relationship with capacity (managed result skips the static limit)',
    tenantRow: { product_code: 'co_managed', licensed_user_count: 1 },
    used: 1,
    gate: () => ({ managed: true }),
    expected: null,
  },
  {
    name: 'non-co-managed tenant at its licensed_user_count',
    tenantRow: { licensed_user_count: 3 },
    used: 3,
    expected: 'LICENSE_LIMIT_REACHED',
  },
  {
    name: 'non-co-managed solo plan with one user',
    tenantRow: { plan: 'solo', licensed_user_count: 1 },
    used: 1,
    expected: 'SOLO_PLAN_LIMIT',
  },
  {
    name: 'non-co-managed tenant under its limit',
    tenantRow: { licensed_user_count: 3 },
    used: 1,
    expected: null,
  },
];

function arrange(c: Case) {
  world.tenantRow = { licensed_user_count: null, plan: 'pro', product_code: 'psa', ...c.tenantRow };
  world.usedInternalUsers = c.used ?? 0;
  world.gate = c.gate ?? null;
}

const actingUser = { user_id: 'admin-1', user_type: 'internal' } as any;
const authContext = { tenant: 'tenant-1' };

async function viaAddUser(): Promise<string | null> {
  const { addUser } = await import('./userActions');
  const result: any = await (addUser as any)(actingUser, authContext, {
    firstName: 'Tech',
    lastName: 'Nician',
    email: 'tech@example.com',
    password: 'password123',
    roleId: 'role-1',
    userType: 'internal',
  });
  return result.success ? null : result.code;
}

async function viaUserServiceCreate(): Promise<string | null> {
  const { UserService } = await import('../../services/UserService');
  const service: any = new UserService();
  vi.spyOn(service, 'createDefaultUserPreferences').mockResolvedValue(undefined);
  vi.spyOn(service, 'logUserActivity').mockResolvedValue(undefined);
  vi.spyOn(service, 'enhanceUsersWithDetails').mockImplementation((async (users: Row[]) => users) as any);
  try {
    await service.create(
      { username: 'tech@example.com', email: 'tech@example.com', password: 'password123', user_type: 'internal', role_ids: ['role-1'] },
      { tenant: 'tenant-1', userId: 'admin-1' }
    );
    return null;
  } catch (error: any) {
    return error.code ?? `UNMAPPED:${error.message}`;
  }
}

const PATHS: Array<[string, () => Promise<string | null>]> = [
  ['addUser', viaAddUser],
  ['UserService.create', viaUserServiceCreate],
];

beforeEach(() => {
  world.state = { users: [], user_roles: [] };
  world.gateCalls = [];
  world.writes = [];
  world.gate = null;
  world.failRoleInsert = false;
});

describe.each(PATHS)('internal-user admission through %s', (_label, run) => {
  it.each(CASES)('$name', async (c) => {
    arrange(c);

    const code = await run();

    expect(code).toBe(c.expected);
    // The admission gate ran, exactly once, on the transaction that did the writes.
    expect(world.gateCalls).toHaveLength(1);
    if (c.expected === null) {
      expect(world.state.users).toHaveLength(1);
      expect(world.state.user_roles).toHaveLength(1);
      expect(new Set(world.writes.map((w) => w.trxId))).toEqual(new Set([world.gateCalls[0].trxId]));
    } else {
      // A refusal leaves no user and no user_roles rows.
      expect(world.state.users).toHaveLength(0);
      expect(world.state.user_roles).toHaveLength(0);
      expect(world.writes).toHaveLength(0);
    }
  });

  it('rolls back the user row together with its roles when the role insert fails after admission', async () => {
    arrange({ name: 'admitted', tenantRow: { product_code: 'co_managed' }, gate: () => ({ managed: true }), expected: null });
    world.failRoleInsert = true;

    // addUser rethrows the unmapped failure; the transaction must have rolled back either way.
    await run().catch(() => undefined);

    expect(world.state.users).toHaveLength(0);
    expect(world.state.user_roles).toHaveLength(0);
  });
});
