/**
 * T174–T183 (behaviour) — F092–F102 of `ee/plans/2026-11-21-itil-remediation` (`priority-pickers`).
 *
 * The server half of the pickers: the canonical board-scoped lister every picker ends up asking,
 * the two integration lookups, and the engine behind `GET /api/v1/tickets/priorities?board_id=`.
 * The client-side filtering is `packages/tickets/src/lib/boardDefaultPriority.test.ts`, and which
 * picker calls what is pinned by `src/test/unit/itilPriorityPickersContract.test.ts`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

const dbRef = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '' }));
const userRef = vi.hoisted(() => ({ user: null as any }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth')>()),
  withAuth: (action: any) => (...args: any[]) => action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
  preCheckDeletion: vi.fn(async () => ({ allowed: true })),
}));

vi.mock('@alga-psa/auth/withAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth/withAuth')>()),
  withAuth: (action: any) => (...args: any[]) => action(userRef.user, { tenant: dbRef.tenant }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

import { tenantDb } from '@alga-psa/db';
import { listPrioritiesForBoard } from '@alga-psa/shared/lib/tickets/boardFieldRules';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  cleanupItilSecondBoardFixture,
  createItilSecondBoardFixture,
  type ItilSecondBoardFixture,
} from './fixtures/itilSecondBoardFixture';

const HOOK_TIMEOUT = 180_000;

let db: Knex;
let fixture: ItilSecondBoardFixture;

function tt(table: string) {
  return tenantDb(db, fixture.tenantId).table(table);
}

describe('ITIL priority pickers (integration)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection({ runSeeds: false });
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    if (!fixture) return;
    await cleanupItilSecondBoardFixture(db, fixture.tenantId);
    fixture = undefined as unknown as ItilSecondBoardFixture;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  async function withFixture(): Promise<void> {
    fixture = await createItilSecondBoardFixture(db);
    dbRef.knex = db;
    dbRef.tenant = fixture.tenantId;
    userRef.user = { user_id: fixture.userId, user_type: 'internal', tenant: fixture.tenantId };
  }

  it('T178, T181: the board-scoped lister answers with one family, the same on both ITIL boards, and never a project-task priority', async () => {
    await withFixture();

    const [onOne, onTwo, onOwn, onMixed] = await Promise.all([
      listPrioritiesForBoard(db, fixture.tenantId, fixture.boards.itilOne, 'ticket'),
      listPrioritiesForBoard(db, fixture.tenantId, fixture.boards.itilTwo, 'ticket'),
      listPrioritiesForBoard(db, fixture.tenantId, fixture.boards.own, 'ticket'),
      listPrioritiesForBoard(db, fixture.tenantId, fixture.boards.mixed, 'ticket'),
    ]);

    const ids = (rows: Array<{ priority_id: string }>) => rows.map((row) => row.priority_id).sort();
    expect(ids(onTwo)).toEqual(ids(onOne));
    expect(ids(onTwo)).toEqual(Object.values(fixture.itilPriorityIds).sort());
    expect(ids(onOwn)).toEqual([...fixture.ownPriorityIds].sort());
    // A legacy mixed board uses ITIL priorities, whatever its categories are.
    expect(ids(onMixed)).toEqual(Object.values(fixture.itilPriorityIds).sort());

    const projectTaskIds = await tt('priorities').where({ item_type: 'project_task' }).pluck('priority_id');
    expect(projectTaskIds.length).toBeGreaterThan(0);
    for (const rows of [onOne, onTwo, onOwn, onMixed]) {
      expect(rows.some((row) => projectTaskIds.includes(row.priority_id))).toBe(false);
    }

    // The level travels with the row, so the REST answer can carry it without a name match (D8).
    expect(onTwo.every((row) => typeof row.itil_priority_level === 'number')).toBe(true);
  }, HOOK_TIMEOUT);

  it('T178: the action the Activities inline picker calls lists by board', async () => {
    await withFixture();
    const { getPrioritiesByBoardType } = await import(
      '../../../../packages/reference-data/src/actions/priorityActions'
    );

    const onTwo = (await getPrioritiesByBoardType(fixture.boards.itilTwo, 'ticket')) as any[];
    expect(onTwo.map((priority) => priority.priority_id).sort()).toEqual(
      Object.values(fixture.itilPriorityIds).sort()
    );

    const onOwn = (await getPrioritiesByBoardType(fixture.boards.own, 'ticket')) as any[];
    expect(onOwn.map((priority) => priority.priority_id).sort()).toEqual([...fixture.ownPriorityIds].sort());
  }, HOOK_TIMEOUT);

  it('T180: the inbound webhook lookup offers ticket priorities, narrowed by the mapped board', async () => {
    await withFixture();
    const { listInboundWebhookLookup } = await import('../../lib/actions/inboundWebhookLookups');

    const onTwo = await listInboundWebhookLookup({
      entityType: 'ticket_priority',
      scope: { board_id: fixture.boards.itilTwo },
    });
    expect(onTwo.map((option: any) => option.value).sort()).toEqual(
      Object.values(fixture.itilPriorityIds).sort()
    );

    const onOwn = await listInboundWebhookLookup({
      entityType: 'ticket_priority',
      scope: { board_id: fixture.boards.own },
    });
    expect(onOwn.map((option: any) => option.value).sort()).toEqual([...fixture.ownPriorityIds].sort());

    // With no board mapped the list is every *ticket* priority — never a project-task one.
    const unscoped = await listInboundWebhookLookup({ entityType: 'ticket_priority' });
    const projectTaskIds = await tt('priorities').where({ item_type: 'project_task' }).pluck('priority_id');
    expect(unscoped.map((option: any) => option.value).sort()).toEqual(
      [...Object.values(fixture.itilPriorityIds), ...fixture.ownPriorityIds].sort()
    );
    expect(unscoped.some((option: any) => projectTaskIds.includes(option.value))).toBe(false);
  }, HOOK_TIMEOUT);

  it('T180: the RMM alert rule editor is offered ticket priorities only', async () => {
    await withFixture();
    const { getRmmAlertRuleFormOptions } = await import(
      '../../../../packages/integrations/src/actions/integrations/rmmAlertRuleActions'
    );

    const result = (await getRmmAlertRuleFormOptions({ integrationId: fixture.tenantId })) as any;
    const options = result?.data ?? result;
    const projectTaskIds = await tt('priorities').where({ item_type: 'project_task' }).pluck('priority_id');
    expect(options.priorities.length).toBeGreaterThan(0);
    expect(options.priorities.some((priority: any) => projectTaskIds.includes(priority.priority_id))).toBe(
      false
    );
  }, HOOK_TIMEOUT);
});
