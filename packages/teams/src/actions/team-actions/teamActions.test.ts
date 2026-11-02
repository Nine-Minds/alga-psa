import { beforeEach, describe, expect, it, vi } from 'vitest';
import { USER_RESPONSE_FIELD_NAMES } from '@alga-psa/types';

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const withTransactionMock = vi.hoisted(() => vi.fn());
const hasPermissionMock = vi.hoisted(() => vi.fn());

type ServerAction = (...args: any[]) => unknown;

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: ServerAction) => (...args: unknown[]) =>
    fn({ user_id: 'user-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  tenantDb: (conn: any) => ({
    table: (table: string) => conn(table),
    tenantJoin: (query: any, table: string, first: string, second: string) => query.join(table, first, second),
  }),
  withTransaction: withTransactionMock,
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  isAuthorizationThrow: (error: unknown) =>
    error instanceof Error && error.message.includes('Permission denied'),
  permissionError: (message: string, key?: string) => ({
    permissionError: message,
    ...(key ? { messageKey: key } : {}),
  }),
  actionError: (message: string, key?: string, params?: Record<string, string | number>) => ({
    actionError: message,
    ...(key ? { messageKey: key } : {}),
    ...(params ? { messageParams: params } : {}),
  }),
}));

// The point of these tests is the real deletion config/validation pair, so the
// published dist is swapped for the in-repo source rather than a stub.
vi.mock('@alga-psa/core/server', async () => {
  return await import('../../../../core/src/server/deletion/deletionActions');
});

type TableData = { rows?: unknown[]; first?: unknown };
type Op = { table: string; op: string; args: unknown[]; clauses: unknown[][] };

/**
 * Knex stand-in that is callable like a transaction, records every terminal
 * operation, and carries commit/rollback so models treat it as an open
 * transaction instead of opening their own.
 */
function createTrx(data: Record<string, TableData> = {}) {
  const ops: Op[] = [];

  const conn: any = (table: string) => {
    const clauses: unknown[][] = [];
    const builder: any = {};
    for (const method of ['where', 'andWhere', 'whereIn', 'select', 'count', 'join', 'returning', 'orderBy']) {
      builder[method] = (...args: unknown[]) => {
        clauses.push([method, ...args]);
        return builder;
      };
    }
    const record = (op: string, args: unknown[] = []) => ops.push({ table, op, args, clauses });

    builder.first = async () => {
      record('first');
      return data[table]?.first ?? null;
    };
    builder.del = async () => {
      record('del');
      return 1;
    };
    builder.update = async (value: unknown) => {
      record('update', [value]);
      return 1;
    };
    builder.insert = async (value: unknown) => {
      record('insert', [value]);
      return Array.isArray(value) ? value : [value];
    };
    builder.then = (onFulfilled: any, onRejected: any) => {
      record('select');
      return Promise.resolve(data[table]?.rows ?? []).then(onFulfilled, onRejected);
    };

    return builder;
  };

  conn.commit = vi.fn(async () => {});
  conn.rollback = vi.fn(async () => {});
  conn.transaction = vi.fn(async (callback: (trx: unknown) => Promise<unknown>) => callback(conn));

  return { conn, ops };
}

/**
 * Dependency-count rows for every table the team delete path may count.
 * team_members defaults to 1 — the lead is always a member — so these tests fail
 * if it is ever reinstated as a blocker.
 */
function teamDependencyCounts(counts: Record<string, number> = {}): Record<string, TableData> {
  const defaults: Record<string, number> = { team_members: 1 };
  return Object.fromEntries(
    [
      'team_members',
      'tickets',
      'project_tasks',
      'project_template_tasks',
      'boards',
      'board_notification_rule_recipients',
    ].map((table) => [
      table,
      { first: { count: String(counts[table] ?? defaults[table] ?? 0) } },
    ])
  );
}

function deletedTables(ops: Op[]): string[] {
  return ops.filter((op) => op.op === 'del').map((op) => op.table);
}

const approvedTeamMemberKeys = [
  'user_id',
  'username',
  'first_name',
  'last_name',
  'email',
  'phone',
  'timezone',
  'user_type',
  'contact_id',
  'icon',
  'created_at',
  'updated_at',
  'two_factor_enabled',
  'two_factor_required_new_device',
  'is_google_user',
  'is_inactive',
  'tenant',
  'reports_to',
  'last_login_at',
  'last_login_method',
  'roles',
  'role',
].sort();

function teamReadFixtures(): Record<string, TableData> {
  return {
    teams: {
      rows: [{ team_id: 'team-1', team_name: 'Support', manager_id: 'user-1', tenant: 'tenant-1' }],
      first: { team_id: 'team-1', team_name: 'Support', manager_id: 'user-1', tenant: 'tenant-1' },
    },
    team_members: {
      rows: [{ user_id: 'user-1', role: 'lead' }],
    },
    users: {
      rows: [{
        user_id: 'user-1',
        username: 'alex',
        first_name: 'Alex',
        last_name: 'Morgan',
        email: 'alex@example.test',
        phone: '555-0100',
        timezone: 'America/New_York',
        user_type: 'internal',
        contact_id: 'contact-1',
        icon: 'avatar.png',
        created_at: new Date('2025-01-01T00:00:00Z'),
        updated_at: new Date('2025-01-02T00:00:00Z'),
        two_factor_enabled: true,
        two_factor_required_new_device: false,
        is_google_user: false,
        is_inactive: false,
        tenant: 'tenant-1',
        reports_to: null,
        last_login_at: new Date('2025-01-03T00:00:00Z'),
        last_login_method: 'password',
        hashed_password: 'password-hash-secret',
        two_factor_secret: 'totp-seed-secret',
        unexpected_column: 'future-column-value',
      }],
    },
    roles: { rows: [{ user_id: 'user-1', role_id: 'role-1', role_name: 'Technician', msp: true, client: false, tenant: 'tenant-1' }] },
  };
}

function expectSafeTeamMember(member: Record<string, any>): void {
  expect(Object.keys(member).sort()).toEqual(approvedTeamMemberKeys);
  expect(Object.keys(member)).not.toContain('hashed_password');
  expect(Object.keys(member)).not.toContain('two_factor_secret');
  expect(Object.keys(member)).not.toContain('unexpected_column');
  expect(member).toMatchObject({
    user_id: 'user-1',
    username: 'alex',
    first_name: 'Alex',
    last_name: 'Morgan',
    email: 'alex@example.test',
    two_factor_enabled: true,
    tenant: 'tenant-1',
    role: 'lead',
    roles: [{ role_id: 'role-1', role_name: 'Technician', msp: true, client: false, tenant: 'tenant-1' }],
  });
  expect(USER_RESPONSE_FIELD_NAMES).toEqual(expect.arrayContaining(approvedTeamMemberKeys.filter((key) => key !== 'roles' && key !== 'role')));
}

function expectSafeUserProjection(ops: Op[]): void {
  const userRead = ops.find((op) => op.table === 'users' && op.op === 'select');
  expect(userRead?.clauses).toContainEqual(['select', USER_RESPONSE_FIELD_NAMES]);
}

describe('team actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    hasPermissionMock.mockResolvedValue(true);
  });

  describe('safe team-member responses', () => {
    it('returns only the approved member DTO from getTeams', async () => {
      const { conn, ops } = createTrx(teamReadFixtures());
      createTenantKnexMock.mockResolvedValue({ knex: conn });

      const { getTeams } = await import('./teamActions');
      const result = await getTeams();

      expect(result).toHaveLength(1);
      expectSafeTeamMember((result as any[])[0].members[0]);
      expectSafeUserProjection(ops);
    });

    it('returns only the approved member DTO from getTeamById', async () => {
      const { conn, ops } = createTrx(teamReadFixtures());
      createTenantKnexMock.mockResolvedValue({ knex: conn });

      const { getTeamById } = await import('./teamActions');
      const result = await getTeamById('team-1');

      expectSafeTeamMember((result as any).members[0]);
      expectSafeUserProjection(ops);
    });
  });

  describe('deleteTeam', () => {
    it('deletes a team whose only member is its lead', async () => {
      const { conn: trx, ops } = createTrx(teamDependencyCounts());
      const knex = { transaction: vi.fn(async (callback: (t: unknown) => Promise<unknown>) => callback(trx)) };
      createTenantKnexMock.mockResolvedValue({ knex });

      const { deleteTeam } = await import('./teamActions');
      const result = await deleteTeam('team-1');

      expect(result).toMatchObject({ success: true, deleted: true, canDelete: true });
      // team_members is no longer a blocker, so the lead's own membership row
      // gets cleaned up by Team.delete instead of blocking the delete.
      expect(deletedTables(ops)).toEqual(['calendar_shares', 'team_members', 'teams']);

      const calendarShareDelete = ops.find((op) => op.table === 'calendar_shares' && op.op === 'del');
      expect(calendarShareDelete?.clauses).toEqual([
        ['where', { grantee_type: 'team', grantee_id: 'team-1' }],
      ]);

      // Team.delete must reuse the validation transaction, not open its own.
      expect(knex.transaction).toHaveBeenCalledTimes(1);
      expect(trx.transaction).not.toHaveBeenCalled();
      expect(trx.commit).not.toHaveBeenCalled();
    });

    it('still blocks when a ticket is assigned to the team', async () => {
      const { conn: trx, ops } = createTrx(teamDependencyCounts({ tickets: 1 }));
      const knex = { transaction: vi.fn(async (callback: (t: unknown) => Promise<unknown>) => callback(trx)) };
      createTenantKnexMock.mockResolvedValue({ knex });

      const { deleteTeam } = await import('./teamActions');
      const result = await deleteTeam('team-1');

      expect(result).toMatchObject({
        success: false,
        canDelete: false,
        code: 'DEPENDENCIES_EXIST',
      });
      expect(result.dependencies).toEqual([
        expect.objectContaining({ type: 'ticket', count: 1 }),
      ]);
      expect(deletedTables(ops)).toEqual([]);
    });
  });

  describe('saveTeamChanges', () => {
    it('rejects removing the user being promoted to lead', async () => {
      const { conn, ops } = createTrx({
        teams: { first: { team_id: 'team-1', team_name: 'Alpha', manager_id: 'user-a', tenant: 'tenant-1' } },
      });
      createTenantKnexMock.mockResolvedValue({ knex: conn });
      withTransactionMock.mockImplementation(async (_db: unknown, callback: (t: unknown) => Promise<unknown>) =>
        callback(conn)
      );

      const { saveTeamChanges } = await import('./teamActions');
      const result = await saveTeamChanges('team-1', {
        managerId: 'user-b',
        addUserIds: [],
        removeUserIds: ['user-b'],
      });

      expect(result).toEqual({
        actionError: 'Cannot remove the team lead. Please assign a new team lead first.',
        messageKey: 'msp/settings:errors.teams.cannotRemoveLead',
      });
      // The guard runs before any write, so manager_id never points at a non-member.
      expect(ops.filter((op) => op.op === 'update' || op.op === 'del')).toEqual([]);
    });

    it('allows handing the lead over and removing the previous lead', async () => {
      const { conn, ops } = createTrx({
        teams: { first: { team_id: 'team-1', team_name: 'Alpha', manager_id: 'user-b', tenant: 'tenant-1' } },
        team_members: {
          first: { team_id: 'team-1', user_id: 'user-b', role: 'member' },
          rows: [{ user_id: 'user-b', role: 'lead' }],
        },
        users: { rows: [{ user_id: 'user-b', user_name: 'b', is_inactive: false }] },
        roles: { rows: [] },
      });
      createTenantKnexMock.mockResolvedValue({ knex: conn });
      withTransactionMock.mockImplementation(async (_db: unknown, callback: (t: unknown) => Promise<unknown>) =>
        callback(conn)
      );

      const { saveTeamChanges } = await import('./teamActions');
      const result = await saveTeamChanges('team-1', {
        managerId: 'user-b',
        addUserIds: [],
        removeUserIds: ['user-a'],
      });

      expect(result).toMatchObject({
        team_id: 'team-1',
        manager_id: 'user-b',
        members: [expect.objectContaining({ user_id: 'user-b', role: 'lead' })],
      });

      const memberDelete = ops.find((op) => op.table === 'team_members' && op.op === 'del');
      expect(memberDelete?.clauses).toEqual([
        ['where', { team_id: 'team-1' }],
        ['whereIn', 'user_id', ['user-a']],
      ]);
      expect(ops).toContainEqual(
        expect.objectContaining({ table: 'teams', op: 'update', args: [{ manager_id: 'user-b' }] })
      );
    });
  });
});
