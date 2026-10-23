/**
 * Contract tests for `isActivityOnUsersListForApi` / `isActivityOnMyList` (alga0002045).
 *
 * The real-DB matrix (primary assignee / resource row / unrelated user / other tenant /
 * closed record) needs Postgres. Here the matrix is pinned two ways that need no database:
 *  1. The shared predicates are compiled to SQL with a real (connectionless) knex and the
 *     WHERE structure is asserted per matrix row: each way of being "on my list" is present,
 *     the resource sub-query is tenant-scoped, and nothing excludes closed records.
 *  2. The core function is run against a mocked DB/permission layer to pin the early-outs
 *     (unknown type, missing `user_schedule:read`, empty id) and the "closed counts" /
 *     "other tenant's id" outcomes, which follow from the row lookup result.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import knexFactory from 'knex';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  firstResult: undefined as unknown,
  tableCalls: [] as string[],
  createTenantKnex: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db').catch(() => ({} as any));
  return {
    ...actual,
    createTenantKnex: mocks.createTenantKnex,
    withTransaction: async (_db: unknown, fn: (trx: unknown) => unknown) => fn({}),
    tenantDb: () => ({
      table: (name: string) => {
        mocks.tableCalls.push(name);
        const q: any = {
          where: () => q,
          first: async () => mocks.firstResult,
        };
        return q;
      },
    }),
  };
});
vi.mock('@alga-psa/auth/withAuth', () => ({ withAuth: (fn: unknown) => fn }));

import { isActivityOnUsersListForApi } from './activityGroupCore';
import { whereProjectTaskOnUsersList, whereTicketOnUsersList } from './activityAssignmentScope';

const USER = { user_id: 'user-1' } as any;

describe('shared on-my-list predicates (compiled SQL)', () => {
  const knex = knexFactory({ client: 'pg' });
  // A TenantDb stand-in that scopes every table by tenant, like `tenantDb(trx, tenant).table`.
  const scopedDb: any = {
    table: (name: string) => knex(name).where(`${name}.tenant`, 'tenant-A'),
  };

  const compile = (table: string, predicate: any) =>
    knex(table).where(predicate).toSQL().toNative();

  it('ticket: primary assignee, resource assigned_to and additional_user_id are all on the list', () => {
    const { sql, bindings } = compile('tickets', whereTicketOnUsersList(scopedDb, knex as any, 'user-1'));
    expect(sql).toContain('"tickets"."assigned_to" = $1');
    expect(sql).toMatch(/or exists \(select 1 from "ticket_resources"/);
    expect(sql).toContain('ticket_resources.ticket_id = tickets.ticket_id');
    expect(sql).toContain('"ticket_resources"."assigned_to"');
    expect(sql).toContain('"ticket_resources"."additional_user_id"');
    // every user binding is the requested user; the resource sub-query carries the tenant
    expect(bindings).toContain('tenant-A');
    expect(bindings.filter((b) => b !== 'tenant-A').every((b) => b === 'user-1')).toBe(true);
  });

  it('ticket: nothing about closed status or other tenants widens the match', () => {
    const { sql } = compile('tickets', whereTicketOnUsersList(scopedDb, knex as any, 'user-1'));
    expect(sql).not.toMatch(/is_closed|status_id|closed/i);
    expect(sql).toContain('"ticket_resources"."tenant" = $');
  });

  it('project task: same matrix against task_resources', () => {
    const { sql, bindings } = compile('project_tasks', whereProjectTaskOnUsersList(scopedDb, knex as any, 'user-1'));
    expect(sql).toContain('"project_tasks"."assigned_to" = $1');
    expect(sql).toMatch(/or exists \(select 1 from "task_resources"/);
    expect(sql).toContain('task_resources.task_id = project_tasks.task_id');
    expect(sql).toContain('"task_resources"."assigned_to"');
    expect(sql).toContain('"task_resources"."additional_user_id"');
    expect(sql).toContain('"task_resources"."tenant" = $');
    expect(bindings).toContain('tenant-A');
    expect(sql).not.toMatch(/is_closed|closed/i);
  });
});

describe('isActivityOnUsersListForApi', () => {
  beforeEach(() => {
    mocks.hasPermission.mockReset().mockResolvedValue(true);
    mocks.createTenantKnex.mockReset().mockResolvedValue({ knex: {} });
    mocks.firstResult = undefined;
    mocks.tableCalls.length = 0;
  });

  it('returns false without touching the database for an unknown activity type', async () => {
    await expect(isActivityOnUsersListForApi(USER, 't', 'scheduleEntry', 'x')).resolves.toBe(false);
    await expect(isActivityOnUsersListForApi(USER, 't', 'nonsense', 'x')).resolves.toBe(false);
    expect(mocks.createTenantKnex).not.toHaveBeenCalled();
  });

  it('returns false (does not throw) without user_schedule:read', async () => {
    mocks.hasPermission.mockResolvedValue(false);
    mocks.firstResult = { ticket_id: 'tk' };
    await expect(isActivityOnUsersListForApi(USER, 't', 'ticket', 'tk')).resolves.toBe(false);
    expect(mocks.hasPermission).toHaveBeenCalledWith(USER, 'user_schedule', 'read', expect.anything());
    expect(mocks.tableCalls).toEqual([]);
  });

  it('returns false for an empty id', async () => {
    await expect(isActivityOnUsersListForApi(USER, 't', 'ticket', '')).resolves.toBe(false);
  });

  it('ticket: true when a row matches (assignee / resource / closed alike), false when none (unrelated user, other tenant)', async () => {
    mocks.firstResult = { ticket_id: 'tk' };
    await expect(isActivityOnUsersListForApi(USER, 't', 'ticket', 'tk')).resolves.toBe(true);
    expect(mocks.tableCalls).toEqual(['tickets']);
    mocks.firstResult = undefined;
    await expect(isActivityOnUsersListForApi(USER, 't', 'ticket', 'tk')).resolves.toBe(false);
  });

  it('project task: queries project_tasks', async () => {
    mocks.firstResult = { task_id: 'pt' };
    await expect(isActivityOnUsersListForApi(USER, 't', 'projectTask', 'pt')).resolves.toBe(true);
    expect(mocks.tableCalls).toEqual(['project_tasks']);
    mocks.firstResult = undefined;
    await expect(isActivityOnUsersListForApi(USER, 't', 'projectTask', 'pt')).resolves.toBe(false);
  });
});

describe('isActivityOnUsersListForApi source contract', () => {
  const core = readFileSync(join(__dirname, 'activityGroupCore.ts'), 'utf8');
  const actions = readFileSync(join(__dirname, 'activityGroupActions.ts'), 'utf8');
  const fn = core.slice(core.indexOf('export async function isActivityOnUsersListForApi'));

  it('is tenant-scoped through tenantDb and the shared predicates, with no closed-status filter', () => {
    expect(fn).toContain('tenantDb(trx, tenant)');
    expect(fn).toContain('scopedDb.table("tickets")');
    expect(fn).toContain('scopedDb.table("project_tasks")');
    expect(fn).toContain('whereTicketOnUsersList(scopedDb, trx, user.user_id)');
    expect(fn).toContain('whereProjectTaskOnUsersList(scopedDb, trx, user.user_id)');
    expect(fn).not.toMatch(/is_closed/);
  });

  it('the withAuth action takes only the type and id (session user only, no targetUserId)', () => {
    const action = actions.slice(actions.indexOf('export const isActivityOnMyList'), actions.indexOf('export const createActivityGroup'));
    expect(action).toContain('withAuth(');
    expect(action).toContain('activityType: string');
    expect(action).toContain('activityId: string');
    expect(action).not.toContain('targetUserId');
    expect(action).toContain('isActivityOnUsersListForApi(user, tenant, activityType, activityId)');
  });

  it('documents that group membership survives reassignment (D7)', () => {
    expect(core).toMatch(/Reassignment keeps group membership/);
    expect(core).toMatch(/Membership lifecycle decision/);
  });
});
