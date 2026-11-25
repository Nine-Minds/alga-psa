/**
 * Bulk user creation (alga-2026-0003355).
 *
 * bulkCreateUsers opens one transaction for the batch but used to create each
 * user through `this.create()`, which opens an independent top-level
 * transaction of its own: the batch transaction was decoration, a failed user
 * could not be skipped without poisoning it, and `skip_invalid: false` could
 * not roll earlier users back. Each user is now created under its own savepoint
 * inside the batch transaction.
 *
 * The database is modelled here (one in-memory store with savepoint semantics)
 * so the orchestration is exercised without a live Postgres: rows written in a
 * savepoint are visible to later users in the same batch, discarded alone when
 * that savepoint rolls back, and discarded wholesale when the batch does.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

interface StoredRow {
  table: string;
  row: Record<string, any>;
}

interface Frame {
  parent: Frame | null;
  rows: StoredRow[];
}

const store = vi.hoisted(() => ({
  committed: [] as Array<{ table: string; row: Record<string, any> }>,
  rootTransactions: 0,
  savepoints: 0,
  savepointRollbacks: 0,
  batchRollbacks: 0,
  // Emails the seat admission pre-check refuses, i.e. a tenant that is already
  // at its limit when the batch starts — the common production rejection.
  seatPreReject: new Set<string>(),
  // Emails whose post-insert seat tripwire fails, i.e. a user that is rejected
  // only after its row is already written (the race).
  seatTripwire: new Set<string>(),
  roleIds: new Set<string>(),
  // Users of other tenants, seen only through the admin connection's
  // cross-tenant email check.
  otherTenantUsers: [] as Array<Record<string, any>>,
}));

// The cross-tenant email check reads on the admin connection, outside the
// batch transaction; its queries resolve against otherTenantUsers.
const adminConnection = vi.hoisted(() => ({ admin: true }));
vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => adminConnection,
}));

// Only the two seat probes are doubled; the rejection predicate the service
// branches on is the real one, so the admission shapes here have to be the
// shapes the guard actually returns.
vi.mock('../lib/internalUserLicenseGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/internalUserLicenseGuard')>()),
  admitInternalUserSeat: async (_trx: unknown, _tenant: string, options: any) =>
    store.seatPreReject.has(options?.email)
      ? { ok: false, code: 'LICENSE_LIMIT_REACHED', error: 'No available user licenses for this tenant' }
      : { ok: true, email: options?.email },
  assertInternalUserSeatsWithinLimit: async (_trx: unknown, _tenant: string, admission: any) => {
    if (admission?.email && store.seatTripwire.has(admission.email)) {
      throw new Error('Seat limit reached for this tenant');
    }
  },
}));

// UserService pulls verifyAuthenticator from the auth package, whose index
// reaches next-auth; stub the one export it uses rather than loading that
// chain, as the rest of this package's suite does.
vi.mock('@alga-psa/auth', () => ({
  verifyAuthenticator: () => true,
}));

vi.mock('@alga-psa/core/encryption', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/core/encryption')>()),
  hashPassword: async (password: string) => `hashed:${password}`,
}));

vi.mock('@alga-psa/user-composition/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/user-composition/lib/permissions')>()),
  hasPermission: async () => true,
}));

vi.mock('@alga-psa/db/models/user', async (importOriginal) => {
  const original = await importOriginal<any>();
  return { ...original, default: { ...original.default, getUserRoles: async () => [] } };
});

vi.mock('@alga-psa/formatting/avatarUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/formatting/avatarUtils')>()),
  getUserAvatarUrl: async () => null,
}));

vi.mock('@alga-psa/db/tenantDb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db/tenantDb')>()),
  tenantDb: (conn: any, tenant: string) => ({
    tenant,
    table: (expression: string) => buildQuery(frameOf(conn), tenant, expression.split(' ')[0]),
    unscoped: (_table: string, _reason: string) => {
      if (conn !== adminConnection) {
        throw new Error('Cross-tenant read issued on a connection other than the admin connection');
      }
      const predicates: Array<(row: Record<string, any>) => boolean> = [];
      const builder: any = {
        where: (criteria: Record<string, any>) => {
          predicates.push((row) => Object.entries(criteria).every(([key, value]) => row[key] === value));
          return builder;
        },
        whereNot: (column: string, value: any) => {
          predicates.push((row) => row[column] !== value);
          return builder;
        },
        first: async () => store.otherTenantUsers.find((row) => predicates.every((predicate) => predicate(row))),
      };
      return builder;
    },
    tenantJoin: () => undefined,
  }),
}));

// ---------------------------------------------------------------------------
// In-memory database with savepoint semantics
// ---------------------------------------------------------------------------

const frames = new WeakMap<object, Frame>();

function frameOf(conn: any): Frame {
  const frame = frames.get(conn);
  if (!frame) {
    throw new Error('Query issued on a connection that is not inside the batch transaction');
  }
  return frame;
}

function visibleRows(frame: Frame | null, table: string, tenant: string): Record<string, any>[] {
  const rows = store.committed.filter((entry) => entry.table === table).map((entry) => entry.row);
  const stack: Frame[] = [];
  for (let current = frame; current; current = current.parent) {
    stack.unshift(current);
  }
  for (const level of stack) {
    for (const entry of level.rows) {
      if (entry.table === table) rows.push(entry.row);
    }
  }
  return rows.filter((row) => row.tenant === tenant);
}

function materialize(value: any): any {
  if (value && typeof value === 'object' && typeof value.__raw === 'string') {
    return value.__raw === 'gen_random_uuid()' ? randomUUID() : new Date('2026-11-19T00:00:00Z');
  }
  return value;
}

function buildQuery(frame: Frame, tenant: string, table: string) {
  const predicates: Array<(row: Record<string, any>) => boolean> = [];
  let inserted: Record<string, any>[] | null = null;

  const run = async (returning?: readonly string[]): Promise<Record<string, any>[]> => {
    if (inserted) {
      for (const row of inserted) {
        frame.rows.push({ table, row });
      }
      if (!returning) return [];
      return inserted.map((row) =>
        Object.fromEntries(returning.filter((field) => field in row).map((field) => [field, row[field]])),
      );
    }
    return visibleRows(frame, table, tenant).filter((row) => predicates.every((predicate) => predicate(row)));
  };

  const builder: any = {
    where: (column: any, value?: any) => {
      if (typeof column === 'object') {
        predicates.push((row) => Object.entries(column).every(([key, expected]) => row[key] === expected));
      } else {
        predicates.push((row) => row[column] === value);
      }
      return builder;
    },
    andWhere: (column: any, value?: any) => builder.where(column, value),
    whereIn: (column: string, values: any[]) => {
      predicates.push((row) => values.includes(row[column]));
      return builder;
    },
    whereNull: () => builder,
    whereNot: () => builder,
    select: () => builder,
    orderBy: () => builder,
    first: async () => (await run())[0],
    insert: (values: any) => {
      const rows = (Array.isArray(values) ? values : [values]).map((value) =>
        Object.fromEntries(Object.entries(value).map(([key, raw]) => [key, materialize(raw)])),
      );
      inserted = rows;
      return builder;
    },
    // The shared user_roles write asks for ON CONFLICT DO NOTHING; the store
    // already keys rows by their own identity, so both are pass-throughs.
    onConflict: () => builder,
    ignore: () => builder,
    returning: (fields: string | readonly string[]) => {
      const list = typeof fields === 'string' ? [fields] : fields;
      return { then: (resolve: any, reject: any) => run(list).then(resolve, reject) };
    },
    then: (resolve: any, reject: any) => run().then(resolve, reject),
  };

  return builder;
}

function makeTransaction(parent: Frame | null) {
  const frame: Frame = { parent, rows: [] };
  const handle: any = {
    isTransaction: true,
    raw: (sql: string) => ({ __raw: sql }),
    fn: { now: () => ({ __raw: 'now()' }) },
    transaction: async (callback: (trx: any) => Promise<unknown>) => {
      store.savepoints += 1;
      const child = makeTransaction(frame);
      try {
        const result = await callback(child.handle);
        frame.rows.push(...child.frame.rows);
        return result;
      } catch (error) {
        store.savepointRollbacks += 1;
        throw error;
      }
    },
  };
  frames.set(handle, frame);
  return { frame, handle };
}

const fakeKnex: any = {
  transaction: async (callback: (trx: any) => Promise<unknown>) => {
    store.rootTransactions += 1;
    const { frame, handle } = makeTransaction(null);
    try {
      const result = await callback(handle);
      store.committed.push(...frame.rows);
      return result;
    } catch (error) {
      store.batchRollbacks += 1;
      throw error;
    }
  },
};

const { UserService } = await import('./UserService');

const TENANT = 'tenant-1';
const ROLE_ID = '33333333-3333-4333-8333-333333333333';
const CLIENT_ROLE_ID = '44444444-4444-4444-8444-444444444444';
const context: any = { tenant: TENANT, userId: 'actor-1', user: { user_id: 'actor-1' } };

function makeService() {
  const service: any = new UserService();
  service.getKnex = async () => ({ knex: fakeKnex, tenant: TENANT });
  return service;
}

function newUser(suffix: string, overrides: Record<string, any> = {}) {
  return {
    username: `tech.${suffix}`,
    email: `tech.${suffix}@example.com`,
    password: 'Zq7!quartzFern',
    user_type: 'internal',
    role_ids: [ROLE_ID],
    ...overrides,
  } as any;
}

function committedTable(table: string): Record<string, any>[] {
  return store.committed.filter((entry) => entry.table === table).map((entry) => entry.row);
}

function committedEmails(): string[] {
  return committedTable('users').map((row) => row.email);
}

beforeEach(() => {
  store.committed = [];
  store.rootTransactions = 0;
  store.savepoints = 0;
  store.savepointRollbacks = 0;
  store.batchRollbacks = 0;
  store.seatPreReject = new Set();
  store.seatTripwire = new Set();
  store.otherTenantUsers = [];
  // The roles the batch references exist in this tenant, each flagged for the
  // portal it belongs to.
  store.committed.push({
    table: 'roles',
    row: { tenant: TENANT, role_id: ROLE_ID, role_name: 'Technician', msp: true, client: false },
  });
  store.committed.push({
    table: 'roles',
    row: { tenant: TENANT, role_id: CLIENT_ROLE_ID, role_name: 'Client', msp: false, client: true },
  });
});

describe('bulkCreateUsers', () => {
  it('creates every user of the batch in one transaction, one savepoint per user', async () => {
    const result = await makeService().bulkCreateUsers(
      [newUser('a'), newUser('b'), newUser('c')],
      context,
      {},
    );

    expect(result).toMatchObject({ total_processed: 3, successful: 3, failed: 0, errors: [] });
    expect(result.results).toHaveLength(3);
    expect(committedEmails()).toEqual([
      'tech.a@example.com',
      'tech.b@example.com',
      'tech.c@example.com',
    ]);
    // One batch transaction — not one per user, which is what `this.create()` opened.
    expect(store.rootTransactions).toBe(1);
    expect(store.savepoints).toBe(3);
    // Roles and default preferences land with their user.
    expect(committedTable('user_roles')).toHaveLength(3);
    expect(committedTable('user_preferences')).toHaveLength(18);
  });

  it('sees users created earlier in the same batch, so a duplicate inside it is rejected', async () => {
    const result = await makeService().bulkCreateUsers(
      [newUser('a'), newUser('dup', { email: 'tech.a@example.com' }), newUser('c')],
      context,
      { skip_invalid: true },
    );

    expect(result).toMatchObject({ total_processed: 3, successful: 2, failed: 1 });
    expect(result.errors[0]).toMatchObject({
      index: 1,
      error: 'A user with this email address already exists',
    });
    expect(committedEmails()).toEqual(['tech.a@example.com', 'tech.c@example.com']);
  });

  it('refuses an email another tenant already uses for the same user type', async () => {
    store.otherTenantUsers.push(
      { tenant: 'tenant-2', user_id: 'other-1', email: 'tech.b@example.com', user_type: 'internal' },
      // Same address as a client user elsewhere: allowed, as in userActions.addUser.
      { tenant: 'tenant-2', user_id: 'other-2', email: 'tech.c@example.com', user_type: 'client' },
    );

    const result = await makeService().bulkCreateUsers(
      [newUser('a'), newUser('b'), newUser('c')],
      context,
      { skip_invalid: true },
    );

    expect(result).toMatchObject({ total_processed: 3, successful: 2, failed: 1 });
    expect(result.errors[0]).toMatchObject({
      index: 1,
      error: 'A user with this email address already exists',
    });
    expect(committedEmails()).toEqual(['tech.a@example.com', 'tech.c@example.com']);
  });

  it('skip_invalid records the failed index and still creates the rest, discarding its partial rows', async () => {
    store.seatTripwire.add('tech.b@example.com');

    const result = await makeService().bulkCreateUsers(
      [newUser('a'), newUser('b'), newUser('c')],
      context,
      { skip_invalid: true },
    );

    expect(result).toMatchObject({ total_processed: 3, successful: 2, failed: 1 });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      index: 1,
      error: 'Seat limit reached for this tenant',
      data: { email: 'tech.b@example.com', username: 'tech.b', user_type: 'internal' },
    });
    // The rejected user's row was already inserted when the tripwire fired; its
    // savepoint rolled back alone and the batch committed the other two.
    expect(committedEmails()).toEqual(['tech.a@example.com', 'tech.c@example.com']);
    expect(store.savepointRollbacks).toBe(1);
    expect(store.batchRollbacks).toBe(0);
  });

  it('skips a user the seat pre-check refuses and still creates the ones that fit', async () => {
    // The ordinary production rejection: the tenant is already at its licensed
    // seat count when the batch starts, so admission fails before any insert.
    store.seatPreReject.add('tech.b@example.com');

    const result = await makeService().bulkCreateUsers(
      [newUser('a'), newUser('b'), newUser('c')],
      context,
      { skip_invalid: true },
    );

    expect(result).toMatchObject({ total_processed: 3, successful: 2, failed: 1 });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      index: 1,
      error: 'No available user licenses for this tenant',
      data: { email: 'tech.b@example.com' },
    });
    // The refused user never reaches an insert, and the user *after* it in the
    // batch is still created.
    expect(committedEmails()).toEqual(['tech.a@example.com', 'tech.c@example.com']);
    expect(committedTable('user_roles')).toHaveLength(2);
    expect(store.savepointRollbacks).toBe(1);
    expect(store.batchRollbacks).toBe(0);
  });

  it('rolls the whole batch back when the seat pre-check refuses and skip_invalid is false', async () => {
    store.seatPreReject.add('tech.c@example.com');

    await expect(
      makeService().bulkCreateUsers([newUser('a'), newUser('b'), newUser('c')], context, {
        skip_invalid: false,
      }),
    ).rejects.toThrow('No available user licenses for this tenant');

    // The two users ahead of the refused one fit their seats and were written;
    // the batch is atomic, so nothing is committed.
    expect(committedEmails()).toEqual([]);
    expect(committedTable('user_roles')).toEqual([]);
    expect(store.batchRollbacks).toBe(1);
  });

  it('refuses a client user holding an MSP role, and creates the one with a client role', async () => {
    const result = await makeService().bulkCreateUsers(
      [
        newUser('portal', { user_type: 'client', role_ids: [ROLE_ID] }),
        newUser('portal2', { user_type: 'client', role_ids: [CLIENT_ROLE_ID] }),
      ],
      context,
      { skip_invalid: true },
    );

    expect(result).toMatchObject({ total_processed: 2, successful: 1, failed: 1 });
    expect(result.errors[0]).toMatchObject({
      index: 0,
      error: 'Cannot assign an MSP role to a client portal user.',
      data: { email: 'tech.portal@example.com', user_type: 'client' },
    });
    expect(committedEmails()).toEqual(['tech.portal2@example.com']);
  });

  it('never echoes the submitted password in an error', async () => {
    store.seatTripwire.add('tech.b@example.com');

    const result = await makeService().bulkCreateUsers([newUser('b')], context, { skip_invalid: true });

    expect(JSON.stringify(result.errors)).not.toContain('Zq7!quartzFern');
  });

  it('rolls every row of the batch back when skip_invalid is false', async () => {
    store.seatTripwire.add('tech.c@example.com');

    await expect(
      makeService().bulkCreateUsers([newUser('a'), newUser('b'), newUser('c')], context, {
        skip_invalid: false,
      }),
    ).rejects.toThrow('Seat limit reached for this tenant');

    // Not just the failing user: the two that succeeded are gone too.
    expect(committedEmails()).toEqual([]);
    expect(committedTable('user_roles')).toEqual([]);
    expect(store.batchRollbacks).toBe(1);
  });

  it('dry_run reports validation results and writes nothing', async () => {
    const result = await makeService().bulkCreateUsers(
      [newUser('a'), newUser('short', { password: 'abc' }), newUser('nomail', { email: 'not-an-email' })],
      context,
      { dry_run: true },
    );

    expect(result).toMatchObject({ total_processed: 3, successful: 1, failed: 2, results: [] });
    expect(result.errors.map((error: any) => error.index)).toEqual([1, 2]);
    expect(result.errors[0].error).toContain('Password must be at least 8 characters');
    expect(result.errors[1].error).toContain('Valid email is required');
    // No transaction is opened at all for a dry run.
    expect(store.rootTransactions).toBe(0);
    expect(committedEmails()).toEqual([]);
  });
});
