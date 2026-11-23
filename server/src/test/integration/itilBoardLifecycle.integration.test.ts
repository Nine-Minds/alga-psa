/**
 * T185–T196 — F103–F112 of `ee/plans/2026-11-21-itil-remediation` (`board-lifecycle`).
 *
 * Board create, update and delete are one implementation (`createBoardCore`, `updateBoardCore`,
 * `deleteBoardCore`) that the settings actions and the REST `BoardService` both call, so a board
 * made through the API has the same statuses, categories, default priority and SLA assignment as
 * one made in settings, and a delete refuses for the same reasons on both. The rules applied here
 * are R1 (one kind per board), R3 (a default priority of the board's family) and R7 (which
 * priority a board defaults to).
 *
 * The functions are driven directly: both callers wrap them in nothing but authentication,
 * transaction and error shaping, which `src/test/unit/itilBoardLifecycleContract.test.ts` pins.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';

const dbRef = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '' }));
const userRef = vi.hoisted(() => ({ user: null as any }));
const publishedRef = vi.hoisted(() => ({ events: [] as any[] }));

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

vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));

vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/event-bus/publishers')>()),
  publishEvent: vi.fn(async (event: any) => {
    publishedRef.events.push(event);
  }),
}));

import { tenantDb } from '@alga-psa/db';
import {
  createBoardCore,
  deleteBoardCore,
  isBoardLifecycleError,
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

async function createdBoardIds(): Promise<string[]> {
  const known = new Set(Object.values(fixture.boards));
  return (await tt('boards').pluck('board_id')).filter((id: string) => !known.has(id));
}

describe('ITIL board lifecycle (integration)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection({ runSeeds: false });
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    if (!fixture) return;
    // Boards a test created, with everything that hangs off them.
    const extra = await createdBoardIds();
    if (extra.length > 0) {
      await tt('categories').whereIn('board_id', extra).whereNotNull('parent_category').del();
      await tt('categories').whereIn('board_id', extra).del();
      await tt('statuses').whereIn('board_id', extra).del();
      await tt('boards').whereIn('board_id', extra).update({ default_priority_id: null, sla_policy_id: null });
      await tt('boards').whereIn('board_id', extra).del();
    }
    await tt('sla_policy_targets').del();
    await tt('sla_policies').del();
    await cleanupItilSecondBoardFixture(db, fixture.tenantId);
    fixture = undefined as unknown as ItilSecondBoardFixture;
    publishedRef.events = [];
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  async function withFixture(): Promise<void> {
    fixture = await createItilSecondBoardFixture(db);
    dbRef.knex = db;
    dbRef.tenant = fixture.tenantId;
    userRef.user = { user_id: fixture.userId, user_type: 'internal', tenant: fixture.tenantId };
    publishedRef.events = [];
  }

  async function create(input: Record<string, unknown>) {
    return db.transaction((trx) => createBoardCore(trx, fixture.tenantId, actor(), input as never));
  }

  describe('create (F105, F109, F110)', () => {
    it('T185, T186: a board of either kind is created with statuses, and an ITIL one with its own categories', async () => {
      await withFixture();

      const itilBoard = await create({
        board_name: 'API ITIL board',
        category_type: 'itil',
        priority_type: 'itil',
      });
      const ownBoard = await create({ board_name: 'API own board' });

      // Statuses on both: the REST create used to write a bare row.
      for (const board of [itilBoard, ownBoard]) {
        const statuses = await tt('statuses').where({ board_id: board.board_id, status_type: 'ticket' }).select('name', 'is_default');
        expect(statuses.length, `${board.board_name} has seeded statuses`).toBeGreaterThan(0);
        expect(statuses.some((status: any) => status.is_default)).toBe(true);
      }

      // The ITIL board owns its own copy of the standard set (D9), and the non-ITIL board has none.
      const standardCount = Number(
        (await db('standard_categories').where({ is_itil_standard: true }).count('* as n').first() as any).n
      );
      const itilCategories = await tt('categories').where({ board_id: itilBoard.board_id }).select('standard_category_id');
      expect(itilCategories).toHaveLength(standardCount);
      expect(itilCategories.every((row: any) => row.standard_category_id)).toBe(true);
      expect(await tt('categories').where({ board_id: ownBoard.board_id })).toHaveLength(0);

      // R7: each board's default priority is of its own family.
      expect(itilBoard.default_priority_id).toBe(fixture.itilPriorityIds[3]);
      expect(ownBoard.default_priority_id).toBe(fixture.ownPriorityIds[0]);
    }, HOOK_TIMEOUT);

    it('T187: an ITIL board in a tenant that has its own priorities still defaults to an ITIL priority', async () => {
      await withFixture();
      // The fixture's tenant has two own priorities with the lower order numbers, which is exactly
      // the case the old create got wrong: it picked by order before the family.
      const board = await create({ board_name: 'ITIL among own', category_type: 'itil', priority_type: 'itil' });
      expect(board.default_priority_id).toBe(fixture.itilPriorityIds[3]);
    }, HOOK_TIMEOUT);

    it('T188: the first ITIL board of a tenant with no priorities at all takes the level-3 ITIL default', async () => {
      await withFixture();
      // A tenant that has never configured priorities: ITIL setup creates them during the create,
      // which is why the default is settled after that step and not before (F105).
      await tt('boards').update({ default_priority_id: null });
      await tt('tickets').del();
      await tt('priorities').del();

      const board = await create({ board_name: 'First ITIL board', category_type: 'itil', priority_type: 'itil' });
      const seeded = await tt('priorities')
        .where({ is_from_itil_standard: true, item_type: 'ticket' })
        .select('priority_id', 'itil_priority_level');
      expect(seeded.length).toBeGreaterThan(0);
      expect(board.default_priority_id).toBe(
        seeded.find((priority: any) => Number(priority.itil_priority_level) === 3)?.priority_id
      );
    }, HOOK_TIMEOUT);

    it('T189, T190: a mixed board and a default priority of the wrong family are refused', async () => {
      await withFixture();

      for (const kinds of [
        { category_type: 'itil', priority_type: 'custom' },
        { category_type: 'custom', priority_type: 'itil' },
      ]) {
        const refusal = await create({ board_name: `Mixed ${kinds.category_type}`, ...kinds }).catch((error) => error);
        expect(isBoardLifecycleError(refusal), JSON.stringify(kinds)).toBe(true);
        expect(refusal.message).toContain('category_type and priority_type');
      }

      const wrongDefault = await create({
        board_name: 'ITIL with own default',
        category_type: 'itil',
        priority_type: 'itil',
        default_priority_id: fixture.ownPriorityIds[0],
      }).catch((error) => error);
      expect(isBoardLifecycleError(wrongDefault)).toBe(true);
      expect(wrongDefault.message).toContain('ITIL');

      // Nothing was written for any of them.
      expect(await createdBoardIds()).toEqual([]);
    }, HOOK_TIMEOUT);

    it('T185: claiming the default releases the board that held it', async () => {
      await withFixture();
      // The REST create used to do this itself; it moved into the lifecycle with the rest of the
      // create, so both entry points release the previous default exactly once.
      const board = await create({ board_name: 'New default board', is_default: true });
      expect(board.is_default).toBe(true);
      const defaults = await tt('boards').where({ is_default: true }).pluck('board_id');
      expect(defaults).toEqual([board.board_id]);
      expect(
        (await tt('boards').where({ board_id: fixture.boards.own }).first('is_default')).is_default
      ).toBe(false);
    }, HOOK_TIMEOUT);

    it('T192: a board created with a default team keeps it', async () => {
      await withFixture();
      const teamId = randomUUID();
      await tt('teams').insert({
        tenant: fixture.tenantId,
        team_id: teamId,
        team_name: 'Lifecycle team',
        manager_id: fixture.userId,
      });

      const board = await create({ board_name: 'Board with a team', default_assigned_team_id: teamId });
      const stored = await tt('boards').where({ board_id: board.board_id }).first('default_assigned_team_id');
      expect(stored.default_assigned_team_id).toBe(teamId);
      expect(board.default_assigned_team_id).toBe(teamId);

      await tt('boards').where({ board_id: board.board_id }).update({ default_assigned_team_id: null });
      await tt('teams').where({ team_id: teamId }).del();
    }, HOOK_TIMEOUT);

    it('T193: the create result and BOARD_CREATED carry the row as it is after setup', async () => {
      await withFixture();
      const board = await create({ board_name: 'Event board', category_type: 'itil', priority_type: 'itil' });

      const stored = await tt('boards').where({ board_id: board.board_id }).first('default_priority_id', 'sla_policy_id');
      expect(board.default_priority_id).toBe(stored.default_priority_id);
      expect(board.sla_policy_id ?? null).toBe(stored.sla_policy_id ?? null);

      const created = publishedRef.events.filter((event) => event.eventType === 'BOARD_CREATED');
      expect(created).toHaveLength(1);
      expect(created[0].payload.boardId).toBe(board.board_id);
      expect(created[0].payload.changes.after.default_priority_id).toBe(stored.default_priority_id);
      expect(created[0].payload.changes.after.sla_policy_id ?? null).toBe(stored.sla_policy_id ?? null);
    }, HOOK_TIMEOUT);
  });

  describe('update (F106, F108)', () => {
    it('T191: an existing mixed board saves a rename, and no update may produce a mixed board', async () => {
      await withFixture();

      const renamed = await db.transaction((trx) =>
        updateBoardCore(trx, fixture.tenantId, actor(), fixture.boards.mixed, { board_name: 'Legacy Mixed (renamed)' } as never)
      );
      expect(renamed.board_name).toBe('Legacy Mixed (renamed)');

      // Its kinds already differ (D4); a patch that leaves them differing — here the other mixed
      // combination — is refused, while one that makes them agree is not this rule's business.
      const refusal = await db.transaction((trx) =>
        updateBoardCore(trx, fixture.tenantId, actor(), fixture.boards.mixed, {
          category_type: 'itil',
          priority_type: 'custom',
        } as never)
      ).catch((error) => error);
      expect(isBoardLifecycleError(refusal)).toBe(true);
      expect(
        await tt('boards').where({ board_id: fixture.boards.mixed }).first('category_type', 'priority_type')
      ).toMatchObject({ category_type: 'custom', priority_type: 'itil' });

      // And so is making a single-kind board mixed.
      const onItil = await db.transaction((trx) =>
        updateBoardCore(trx, fixture.tenantId, actor(), fixture.boards.itilTwo, { priority_type: 'custom' } as never)
      ).catch((error) => error);
      expect(isBoardLifecycleError(onItil)).toBe(true);
      expect(
        (await tt('boards').where({ board_id: fixture.boards.itilTwo }).first('priority_type')).priority_type
      ).toBe('itil');
    }, HOOK_TIMEOUT);

    it('T189: an update that sets a default priority of the wrong family is refused', async () => {
      await withFixture();
      const refusal = await db.transaction((trx) =>
        updateBoardCore(trx, fixture.tenantId, actor(), fixture.boards.itilTwo, {
          default_priority_id: fixture.ownPriorityIds[1],
        } as never)
      ).catch((error) => error);
      expect(isBoardLifecycleError(refusal)).toBe(true);

      const fitting = await db.transaction((trx) =>
        updateBoardCore(trx, fixture.tenantId, actor(), fixture.boards.itilTwo, {
          default_priority_id: fixture.itilPriorityIds[2],
        } as never)
      );
      expect(fitting.default_priority_id).toBe(fixture.itilPriorityIds[2]);
    }, HOOK_TIMEOUT);
  });

  describe('delete (F112)', () => {
    async function remove(boardId: string, options: { force?: boolean } = {}) {
      return db.transaction((trx) =>
        deleteBoardCore({ db, trx }, fixture.tenantId, actor(), boardId, { force: options.force ?? true })
      );
    }

    it('T195: the default board, a board with tickets and a board used by inbound defaults are refused', async () => {
      await withFixture();

      // `Own Work` is the fixture's default board.
      expect(await remove(fixture.boards.own)).toMatchObject({ success: false, code: 'BOARD_IS_DEFAULT' });

      // A board an inbound-defaults row points at.
      await tt('inbound_ticket_defaults').insert({
        tenant: fixture.tenantId,
        id: randomUUID(),
        short_name: `lifecycle-${randomUUID().slice(0, 8)}`,
        display_name: 'Lifecycle defaults',
        board_id: fixture.boards.itilTwo,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      expect(await remove(fixture.boards.itilTwo)).toMatchObject({
        success: false,
        code: 'BOARD_USED_IN_EMAIL_ROUTING',
      });
      await tt('inbound_ticket_defaults').del();

      // A board with a ticket on it.
      const ticketId = randomUUID();
      await tt('tickets').insert({
        tenant: fixture.tenantId,
        ticket_id: ticketId,
        ticket_number: `T-${ticketId.slice(0, 8)}`,
        title: 'Blocks the delete',
        board_id: fixture.boards.itilTwo,
        status_id: fixture.statuses.itilTwo,
        priority_id: fixture.itilPriorityIds[3],
        client_id: fixture.clientId,
        entered_by: fixture.userId,
        entered_at: new Date().toISOString(),
      });
      const withTicket = await remove(fixture.boards.itilTwo);
      expect(withTicket.success).toBe(false);
      expect(withTicket.message).toMatch(/ticket/i);
      await tt('tickets').where({ ticket_id: ticketId }).del();
    }, HOOK_TIMEOUT);

    it('T196: an unused board is removed with its statuses and categories', async () => {
      await withFixture();
      const board = await create({ board_name: 'Disposable ITIL', category_type: 'itil', priority_type: 'itil' });
      const boardId = board.board_id as string;
      expect(await tt('categories').where({ board_id: boardId })).not.toHaveLength(0);

      const result = await remove(boardId);
      expect(result.success).toBe(true);
      expect(await tt('boards').where({ board_id: boardId }).first()).toBeUndefined();
      expect(await tt('statuses').where({ board_id: boardId })).toHaveLength(0);
      expect(await tt('categories').where({ board_id: boardId })).toHaveLength(0);
      // The other ITIL board keeps its own copies: a delete takes only its own board's set (D9).
      expect(
        (await tt('categories').where({ board_id: fixture.boards.itilTwo }).whereNotNull('standard_category_id')).length
      ).toBeGreaterThan(0);
    }, HOOK_TIMEOUT);
  });
});
