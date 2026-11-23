/**
 * T197–T212 — F113–F121 of `ee/plans/2026-11-21-itil-remediation` (`board-type-switch`).
 *
 * A board's kind is changed through its own action, which sets both kinds together (R1), makes
 * sure the rows the new kind needs exist, and re-settles the board's default priority (R7) — and
 * changes nothing else: no ticket, inbound default, template, schedule or SLA assignment moves
 * with it (D3/D6). The summary an admin confirms counts exactly what will no longer fit.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';

const dbRef = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '' }));
const userRef = vi.hoisted(() => ({ user: null as any }));
const permissionRef = vi.hoisted(() => ({ granted: true }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth')>()),
  withAuth: (action: any) => (...args: any[]) => action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: vi.fn(async () => permissionRef.granted),
  preCheckDeletion: vi.fn(async () => ({ allowed: true })),
}));

vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => permissionRef.granted) }));
vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/event-bus/publishers')>()),
  publishEvent: vi.fn(async () => undefined),
}));

import { tenantDb } from '@alga-psa/db';
import {
  isBoardLifecycleError,
  summariseBoardTypeSwitch,
  switchBoardTypeCore,
  updateBoardCore,
} from '../../../../packages/tickets/src/services/boardLifecycle';
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

const actor = () => ({ userId: fixture.userId });

async function insertTicket(boardId: string, priorityId: string, closed = false): Promise<string> {
  const ticketId = randomUUID();
  const statusKey = (Object.keys(fixture.boards) as Array<keyof ItilSecondBoardFixture['boards']>).find(
    (key) => fixture.boards[key] === boardId
  )!;
  await tt('tickets').insert({
    tenant: fixture.tenantId,
    ticket_id: ticketId,
    ticket_number: `T-${ticketId.slice(0, 8)}`,
    title: 'Switch probe',
    board_id: boardId,
    status_id: fixture.statuses[statusKey],
    priority_id: priorityId,
    client_id: fixture.clientId,
    is_closed: closed,
    entered_by: fixture.userId,
    entered_at: new Date().toISOString(),
  });
  return ticketId;
}

describe('ITIL board type switch (integration)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection({ runSeeds: false });
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    if (!fixture) return;
    await tt('ticket_templates').del();
    await tt('recurring_ticket_definitions').del();
    await tt('inbound_ticket_defaults').del();
    await tt('boards').update({ sla_policy_id: null });
    await tt('sla_policy_targets').del();
    await tt('sla_policies').del();
    await cleanupItilSecondBoardFixture(db, fixture.tenantId);
    fixture = undefined as unknown as ItilSecondBoardFixture;
    permissionRef.granted = true;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  async function withFixture(): Promise<void> {
    fixture = await createItilSecondBoardFixture(db);
    dbRef.knex = db;
    dbRef.tenant = fixture.tenantId;
    userRef.user = { user_id: fixture.userId, user_type: 'internal', tenant: fixture.tenantId };
    permissionRef.granted = true;
  }

  const switchTo = (boardId: string, kind: 'custom' | 'itil') =>
    db.transaction((trx) => switchBoardTypeCore(trx, fixture.tenantId, actor(), boardId, kind));

  it('T197: the action is refused without the ticket_settings permission', async () => {
    await withFixture();
    permissionRef.granted = false;
    const { switchBoardType, getBoardTypeSwitchSummary } = await import(
      '../../../../packages/tickets/src/actions/board-actions/boardActions'
    );

    expect(await switchBoardType(fixture.boards.own, 'itil')).toMatchObject({
      permissionError: expect.stringContaining('Permission denied'),
    });
    expect(await getBoardTypeSwitchSummary(fixture.boards.own, 'itil')).toMatchObject({
      permissionError: expect.stringContaining('Permission denied'),
    });
    expect(
      (await tt('boards').where({ board_id: fixture.boards.own }).first('category_type')).category_type
    ).toBe('custom');
  }, HOOK_TIMEOUT);

  it('T198: switching a non-ITIL board to ITIL gives it the standard set, keeps its own categories and sets an ITIL default', async () => {
    await withFixture();
    const standardCount = Object.keys(fixture.itilCategoryIdsByBoard[fixture.boards.itilOne]).length;

    const board = await switchTo(fixture.boards.own, 'itil');
    expect(board).toMatchObject({ category_type: 'itil', priority_type: 'itil' });
    expect(board.default_priority_id).toBe(fixture.itilPriorityIds[3]);

    const copies = await tt('categories').where({ board_id: fixture.boards.own }).whereNotNull('standard_category_id');
    expect(copies).toHaveLength(standardCount);
    // The board's own categories are still there, now beside the standard set (R2).
    const own = await tt('categories')
      .where({ board_id: fixture.boards.own })
      .whereNull('standard_category_id')
      .pluck('category_id');
    expect(own.sort()).toEqual([fixture.ownCategory.parentId, fixture.ownCategory.childId].sort());
  }, HOOK_TIMEOUT);

  it('T199: switching to ITIL in a tenant with no ITIL priorities creates them', async () => {
    await withFixture();
    await tt('boards').update({ default_priority_id: null, category_type: 'custom', priority_type: 'custom' });
    await tt('tickets').del();
    await tt('priorities').where({ is_from_itil_standard: true }).del();
    expect(await tt('priorities').where({ is_from_itil_standard: true })).toHaveLength(0);

    const board = await switchTo(fixture.boards.own, 'itil');
    const itil = await tt('priorities')
      .where({ is_from_itil_standard: true, item_type: 'ticket' })
      .select('priority_id', 'itil_priority_level');
    expect(itil).toHaveLength(5);
    expect(board.default_priority_id).toBe(
      itil.find((priority: any) => Number(priority.itil_priority_level) === 3)?.priority_id
    );
  }, HOOK_TIMEOUT);

  it('T200, T201: switching an ITIL board to the tenant’s own kind keeps its categories and deletes nothing', async () => {
    await withFixture();
    const categoriesBefore = await tt('categories').orderBy('category_id').select('category_id', 'board_id');
    const prioritiesBefore = await tt('priorities').orderBy('priority_id').pluck('priority_id');

    const board = await switchTo(fixture.boards.itilTwo, 'custom');
    expect(board).toMatchObject({ category_type: 'custom', priority_type: 'custom' });
    expect(board.default_priority_id).toBe(fixture.ownPriorityIds[0]);

    // No category and no priority was removed — and the board kept its own rows, now editable.
    expect(await tt('categories').orderBy('category_id').select('category_id', 'board_id')).toEqual(categoriesBefore);
    expect(await tt('priorities').orderBy('priority_id').pluck('priority_id')).toEqual(prioritiesBefore);

    // Even when it was the last ITIL board of the tenant.
    await switchTo(fixture.boards.itilOne, 'custom');
    expect(await tt('priorities').orderBy('priority_id').pluck('priority_id')).toEqual(prioritiesBefore);
    expect((await tt('categories').orderBy('category_id').select('category_id')).length).toBe(
      categoriesBefore.length
    );
  }, HOOK_TIMEOUT);

  it('T202, T203: a switch in either direction changes no ticket, setting or SLA assignment', async () => {
    await withFixture();
    const policyId = randomUUID();
    await tt('sla_policies').insert({
      tenant: fixture.tenantId,
      sla_policy_id: policyId,
      policy_name: 'Switch policy',
    });
    await tt('boards').where({ board_id: fixture.boards.itilTwo }).update({ sla_policy_id: policyId });

    const ticketId = await insertTicket(fixture.boards.itilTwo, fixture.itilPriorityIds[1]);
    const defaultsId = randomUUID();
    await tt('inbound_ticket_defaults').insert({
      tenant: fixture.tenantId,
      id: defaultsId,
      short_name: `switch-${defaultsId.slice(0, 8)}`,
      display_name: 'Switch defaults',
      board_id: fixture.boards.itilTwo,
      priority_id: fixture.itilPriorityIds[2],
      is_active: true,
    });
    const templateId = randomUUID();
    await tt('ticket_templates').insert({
      tenant: fixture.tenantId,
      template_id: templateId,
      name: 'Switch template',
      title: 'Switch template',
      board_id: fixture.boards.itilTwo,
      priority_id: fixture.itilPriorityIds[2],
    });
    const definitionId = randomUUID();
    await tt('recurring_ticket_definitions').insert({
      tenant: fixture.tenantId,
      definition_id: definitionId,
      name: 'Switch schedule',
      board_id: fixture.boards.itilTwo,
      priority_id: fixture.itilPriorityIds[2],
      recurrence: JSON.stringify({ frequency: 'weekly', interval: 1 }),
      start_date: '2026-01-01',
      created_by: fixture.userId,
    });

    await switchTo(fixture.boards.itilTwo, 'custom');

    expect(await tt('tickets').where({ ticket_id: ticketId }).first('priority_id')).toMatchObject({
      priority_id: fixture.itilPriorityIds[1],
    });
    expect(await tt('inbound_ticket_defaults').where({ id: defaultsId }).first('priority_id')).toMatchObject({
      priority_id: fixture.itilPriorityIds[2],
    });
    expect(await tt('ticket_templates').where({ template_id: templateId }).first('priority_id')).toMatchObject({
      priority_id: fixture.itilPriorityIds[2],
    });
    expect(
      await tt('recurring_ticket_definitions').where({ definition_id: definitionId }).first('priority_id')
    ).toMatchObject({ priority_id: fixture.itilPriorityIds[2] });
    // D6: the policy assignment is left exactly as it was, in either direction.
    expect(await tt('boards').where({ board_id: fixture.boards.itilTwo }).first('sla_policy_id')).toMatchObject({
      sla_policy_id: policyId,
    });

    await switchTo(fixture.boards.itilTwo, 'itil');
    expect(await tt('boards').where({ board_id: fixture.boards.itilTwo }).first('sla_policy_id')).toMatchObject({
      sla_policy_id: policyId,
    });
  }, HOOK_TIMEOUT);

  it('T204: the summary counts the rows whose priority will not fit', async () => {
    await withFixture();
    await insertTicket(fixture.boards.itilTwo, fixture.itilPriorityIds[1]);
    await insertTicket(fixture.boards.itilTwo, fixture.itilPriorityIds[2], true); // closed: not counted
    await insertTicket(fixture.boards.itilTwo, fixture.ownPriorityIds[0]); // already of the new kind
    const defaultsId = randomUUID();
    await tt('inbound_ticket_defaults').insert({
      tenant: fixture.tenantId,
      id: defaultsId,
      short_name: `sum-${defaultsId.slice(0, 8)}`,
      display_name: 'Summary defaults',
      board_id: fixture.boards.itilTwo,
      priority_id: fixture.itilPriorityIds[2],
      is_active: true,
    });
    await tt('ticket_templates').insert({
      tenant: fixture.tenantId,
      template_id: randomUUID(),
      name: 'Summary template',
      title: 'Summary template',
      board_id: fixture.boards.itilTwo,
      priority_id: fixture.itilPriorityIds[4],
    });
    await tt('recurring_ticket_definitions').insert({
      tenant: fixture.tenantId,
      definition_id: randomUUID(),
      name: 'Summary schedule',
      board_id: fixture.boards.itilTwo,
      priority_id: fixture.itilPriorityIds[5],
      recurrence: JSON.stringify({ frequency: 'weekly', interval: 1 }),
      start_date: '2026-01-01',
      created_by: fixture.userId,
    });

    const summary = await summariseBoardTypeSwitch(db, fixture.tenantId, fixture.boards.itilTwo, 'custom');
    expect(summary).toMatchObject({
      boardName: 'ITIL Two',
      from: 'itil',
      to: 'custom',
      mixed: false,
      openTickets: 1,
      inboundDefaults: 1,
      templates: 1,
      schedules: 1,
    });
  }, HOOK_TIMEOUT);

  it('T205: switching to the tenant’s own kind with no own ticket priorities is refused', async () => {
    await withFixture();
    await tt('boards').update({ default_priority_id: null });
    await tt('tickets').del();
    await tt('priorities').where({ is_from_itil_standard: false, item_type: 'ticket' }).del();

    const refusal = await switchTo(fixture.boards.itilTwo, 'custom').catch((error) => error);
    expect(isBoardLifecycleError(refusal)).toBe(true);
    expect(refusal.message).toContain('no ticket priorities of its own');
    expect(
      (await tt('boards').where({ board_id: fixture.boards.itilTwo }).first('priority_type')).priority_type
    ).toBe('itil');
  }, HOOK_TIMEOUT);

  it('T207: a legacy mixed board reports both kinds and can be repaired by the switch', async () => {
    await withFixture();
    const summary = await summariseBoardTypeSwitch(db, fixture.tenantId, fixture.boards.mixed, 'itil');
    expect(summary.mixed).toBe(true);
    expect(summary.from).toBe('itil');

    const board = await switchTo(fixture.boards.mixed, 'itil');
    expect(board).toMatchObject({ category_type: 'itil', priority_type: 'itil' });
  }, HOOK_TIMEOUT);

  it('T208: a board update with a changed kind runs the switch, and one without touches nothing', async () => {
    await withFixture();
    const standardCount = Object.keys(fixture.itilCategoryIdsByBoard[fixture.boards.itilOne]).length;

    const switched = await db.transaction((trx) =>
      updateBoardCore(trx, fixture.tenantId, actor(), fixture.boards.own, {
        category_type: 'itil',
        priority_type: 'itil',
      } as never)
    );
    expect(switched).toMatchObject({ category_type: 'itil', priority_type: 'itil' });
    expect(switched.default_priority_id).toBe(fixture.itilPriorityIds[3]);
    expect(
      (await tt('categories').where({ board_id: fixture.boards.own }).whereNotNull('standard_category_id')).length
    ).toBe(standardCount);

    const categoriesBefore = await tt('categories').count('* as n').first();
    const renamed = await db.transaction((trx) =>
      updateBoardCore(trx, fixture.tenantId, actor(), fixture.boards.itilTwo, {
        board_name: 'ITIL Two (renamed)',
      } as never)
    );
    expect(renamed.board_name).toBe('ITIL Two (renamed)');
    expect(await tt('categories').count('* as n').first()).toEqual(categoriesBefore);
  }, HOOK_TIMEOUT);

  describe('the SLA line of the summary (F117)', () => {
    it('T211: a board with no policy is told so', async () => {
      await withFixture();
      const summary = await summariseBoardTypeSwitch(db, fixture.tenantId, fixture.boards.own, 'itil');
      expect(summary.sla).toEqual({ state: 'none' });
    }, HOOK_TIMEOUT);

    it('T210: a policy with targets for the old family only is reported as having none for the new one', async () => {
      await withFixture();
      const policyId = randomUUID();
      await tt('sla_policies').insert({
        tenant: fixture.tenantId,
        sla_policy_id: policyId,
        policy_name: 'ITIL Standard',
      });
      await tt('sla_policy_targets').insert({
        tenant: fixture.tenantId,
        target_id: randomUUID(),
        sla_policy_id: policyId,
        priority_id: fixture.itilPriorityIds[1],
        response_time_minutes: 30,
        resolution_time_minutes: 240,
      });
      await tt('boards').where({ board_id: fixture.boards.itilTwo }).update({ sla_policy_id: policyId });

      const summary = await summariseBoardTypeSwitch(db, fixture.tenantId, fixture.boards.itilTwo, 'custom');
      expect(summary.sla).toEqual({ state: 'no-targets', policyName: 'ITIL Standard' });
    }, HOOK_TIMEOUT);

    it('T212: a policy with targets for the new family shows no warning', async () => {
      await withFixture();
      const policyId = randomUUID();
      await tt('sla_policies').insert({
        tenant: fixture.tenantId,
        sla_policy_id: policyId,
        policy_name: 'Mixed policy',
      });
      await tt('sla_policy_targets').insert([
        {
          tenant: fixture.tenantId,
          target_id: randomUUID(),
          sla_policy_id: policyId,
          priority_id: fixture.itilPriorityIds[1],
          response_time_minutes: 30,
          resolution_time_minutes: 240,
        },
        {
          tenant: fixture.tenantId,
          target_id: randomUUID(),
          sla_policy_id: policyId,
          priority_id: fixture.ownPriorityIds[0],
          response_time_minutes: 60,
          resolution_time_minutes: 480,
        },
      ]);
      await tt('boards').where({ board_id: fixture.boards.itilTwo }).update({ sla_policy_id: policyId });

      const summary = await summariseBoardTypeSwitch(db, fixture.tenantId, fixture.boards.itilTwo, 'custom');
      expect(summary.sla).toEqual({ state: 'ok', policyName: 'Mixed policy' });
    }, HOOK_TIMEOUT);
  });
});
