/**
 * T003–T030 — F003–F012 of `ee/plans/2026-11-21-itil-remediation` (`core-rules`).
 *
 * The shared board field rules against a real database: which priorities a board offers (R3), the
 * field-level problems it reports, the Impact × Urgency rule (R4), the refuse/fall-back policy
 * (R6), the board default (R7), ITIL priority seeding by level, and the priority write whitelist.
 *
 * Each test builds its own tenant, as `itilBoardDeletionCleanup.integration.test.ts` does, so the
 * priority rows under test are exactly the ones the test inserted.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const dbRef = vi.hoisted(() => ({
  knex: null as Knex | null,
  tenant: '',
}));

const userRef = vi.hoisted(() => ({
  user: null as any,
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
  preCheckDeletion: vi.fn(async () => ({ allowed: true })),
}));

import {
  boardFieldKind,
  defaultPriorityForBoard,
  findBoardFieldProblems,
  findTicketPatchBoardFieldProblems,
  listPrioritiesForBoard,
  resolveItilPriorityId,
  resolveTicketPriorityFields,
} from '@alga-psa/shared/lib/tickets/boardFieldRules';
import { ItilStandardsService } from '../../../../packages/tickets/src/services/itilStandardsService';
import PriorityModel from '../../../../packages/reference-data/src/models/priority';
import { createPriority, updatePriority } from '../../../../packages/reference-data/src/actions/priorityActions';

const HOOK_TIMEOUT = 180_000;

let db: Knex;
const tenantsToCleanup = new Set<string>();

function tt(tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

function tenantRows() {
  return tenantDb(db, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await tt(tenantId, 'tickets').del();
  await tt(tenantId, 'clients').del();
  await tt(tenantId, 'categories').whereNotNull('parent_category').del();
  await tt(tenantId, 'categories').del();
  await tt(tenantId, 'boards').update({ default_priority_id: null });
  await tt(tenantId, 'priorities').del();
  await tt(tenantId, 'statuses').del();
  await tt(tenantId, 'boards').del();
  await tt(tenantId, 'users').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

interface BoardSpec {
  name: string;
  categoryType?: 'custom' | 'itil' | null;
  priorityType?: 'custom' | 'itil' | null;
}

interface Fixture {
  tenantId: string;
  userId: string;
  boards: Record<string, string>;
}

async function createFixture(boards: BoardSpec[]): Promise<Fixture> {
  const tenantId = uuidv4();
  const userId = uuidv4();
  tenantsToCleanup.add(tenantId);

  await tenantRows().insert({
    tenant: tenantId,
    client_name: `Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
  });

  await tt(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `user-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: `user-${tenantId.slice(0, 8)}@example.com`,
  });

  const boardIds: Record<string, string> = {};
  const rows = boards.map((board, index) => {
    const boardId = uuidv4();
    boardIds[board.name] = boardId;
    return {
      tenant: tenantId,
      board_id: boardId,
      board_name: board.name,
      display_order: (index + 1) * 10,
      is_default: index === 0,
      is_inactive: false,
      category_type: board.categoryType === undefined ? 'custom' : board.categoryType,
      priority_type: board.priorityType === undefined ? 'custom' : board.priorityType,
    };
  });
  await tt(tenantId, 'boards').insert(rows);

  dbRef.knex = db;
  dbRef.tenant = tenantId;
  userRef.user = { user_id: userId, user_type: 'internal', tenant: tenantId };

  return { tenantId, userId, boards: boardIds };
}

/** The five ITIL ticket priorities, inserted the way ITIL seeding does. */
async function insertItilPriorities(fixture: Fixture, levels: number[] = [1, 2, 3, 4, 5]): Promise<Record<number, string>> {
  const byLevel: Record<number, string> = {};
  const rows = levels.map((level) => {
    const priorityId = uuidv4();
    byLevel[level] = priorityId;
    return {
      tenant: fixture.tenantId,
      priority_id: priorityId,
      priority_name: `P${level} - ITIL`,
      color: '#DC2626',
      order_number: 99 + level,
      item_type: 'ticket',
      is_from_itil_standard: true,
      itil_priority_level: level,
      created_by: fixture.userId,
    };
  });
  await tt(fixture.tenantId, 'priorities').insert(rows);
  return byLevel;
}

async function insertOwnPriority(
  fixture: Fixture,
  name: string,
  orderNumber: number,
  itemType: 'ticket' | 'project_task' = 'ticket'
): Promise<string> {
  const priorityId = uuidv4();
  await tt(fixture.tenantId, 'priorities').insert({
    tenant: fixture.tenantId,
    priority_id: priorityId,
    priority_name: name,
    color: '#111111',
    order_number: orderNumber,
    item_type: itemType,
    is_from_itil_standard: false,
    created_by: fixture.userId,
  });
  return priorityId;
}

async function insertCategory(fixture: Fixture, name: string, boardId: string | null, parent?: string): Promise<string> {
  const categoryId = uuidv4();
  await tt(fixture.tenantId, 'categories').insert({
    tenant: fixture.tenantId,
    category_id: categoryId,
    category_name: name,
    board_id: boardId,
    parent_category: parent ?? null,
    created_by: fixture.userId,
  });
  return categoryId;
}

describe('shared board field rules (integration)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection({ runSeeds: false });
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    for (const tenantId of tenantsToCleanup) {
      await cleanupTenant(tenantId);
      tenantsToCleanup.delete(tenantId);
    }
  });

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  describe('listPrioritiesForBoard (F003)', () => {
    it('T004: an ITIL board offers exactly the five ITIL ticket priorities, in level order', async () => {
      const fixture = await createFixture([{ name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' }]);
      await insertItilPriorities(fixture, [3, 1, 5, 2, 4]);
      await insertOwnPriority(fixture, 'Own High', 1);

      const offered = await listPrioritiesForBoard(db, fixture.tenantId, fixture.boards['ITIL One']);

      expect(offered.map((priority) => priority.itil_priority_level)).toEqual([1, 2, 3, 4, 5]);
      expect(offered.every((priority) => priority.is_from_itil_standard)).toBe(true);
    });

    it('T005: a non-ITIL board offers only the tenant’s own ticket priorities', async () => {
      const fixture = await createFixture([{ name: 'General' }]);
      await insertItilPriorities(fixture);
      const own = await insertOwnPriority(fixture, 'Own Normal', 2);
      await insertOwnPriority(fixture, 'Own Task', 1, 'project_task');

      const offered = await listPrioritiesForBoard(db, fixture.tenantId, fixture.boards.General);

      expect(offered.map((priority) => priority.priority_id)).toEqual([own]);
    });

    it('T006: a NULL priority_type is the tenant’s own kind', async () => {
      const fixture = await createFixture([{ name: 'Legacy', categoryType: null, priorityType: null }]);
      await insertItilPriorities(fixture);
      const own = await insertOwnPriority(fixture, 'Own Normal', 2);

      expect(boardFieldKind(null)).toBe('custom');
      const offered = await listPrioritiesForBoard(db, fixture.tenantId, fixture.boards.Legacy);
      expect(offered.map((priority) => priority.priority_id)).toEqual([own]);
    });

    it('T007: never returns another tenant’s priorities', async () => {
      const mine = await createFixture([{ name: 'Mine' }]);
      const theirs = await createFixture([{ name: 'Theirs' }]);
      const myPriority = await insertOwnPriority(mine, 'Mine Normal', 1);
      await insertOwnPriority(theirs, 'Theirs Normal', 1);

      const offered = await listPrioritiesForBoard(db, mine.tenantId, mine.boards.Mine);

      expect(offered.map((priority) => priority.priority_id)).toEqual([myPriority]);
    });
  });

  describe('findBoardFieldProblems (F004)', () => {
    it('T008: reports a wrong-family priority on either kind of board, naming both', async () => {
      const fixture = await createFixture([
        { name: 'General' },
        { name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' },
      ]);
      const itil = await insertItilPriorities(fixture);
      const own = await insertOwnPriority(fixture, 'Own Normal', 1);

      const ownOnItil = await findBoardFieldProblems(db, fixture.tenantId, {
        boardId: fixture.boards['ITIL One'],
        priorityId: own,
      });
      expect(ownOnItil).toHaveLength(1);
      expect(ownOnItil[0].field).toBe('priority_id');
      expect(ownOnItil[0].message).toContain('Own Normal');
      expect(ownOnItil[0].message).toContain('ITIL One');
      expect(ownOnItil[0].messageKey).toBe('features/tickets:errors.ticket.priorityCustomBoardItil');

      const itilOnOwn = await findBoardFieldProblems(db, fixture.tenantId, {
        boardId: fixture.boards.General,
        priorityId: itil[1],
      });
      expect(itilOnOwn).toHaveLength(1);
      expect(itilOnOwn[0].message).toContain('P1 - ITIL');
      expect(itilOnOwn[0].message).toContain('General');
      expect(itilOnOwn[0].messageKey).toBe('features/tickets:errors.ticket.priorityItilBoardCustom');
    });

    it('T009: reports a priority that does not exist or is a project-task priority', async () => {
      const fixture = await createFixture([{ name: 'General' }]);
      await insertOwnPriority(fixture, 'Own Normal', 1);
      const taskPriority = await insertOwnPriority(fixture, 'Own Task', 1, 'project_task');

      const missing = await findBoardFieldProblems(db, fixture.tenantId, {
        boardId: fixture.boards.General,
        priorityId: uuidv4(),
      });
      expect(missing).toEqual([
        expect.objectContaining({ field: 'priority_id', message: 'The selected priority no longer exists' }),
      ]);

      const wrongItemType = await findBoardFieldProblems(db, fixture.tenantId, {
        boardId: fixture.boards.General,
        priorityId: taskPriority,
      });
      expect(wrongItemType).toHaveLength(1);
      expect(wrongItemType[0].field).toBe('priority_id');
      expect(wrongItemType[0].message).toContain('not a ticket priority');
    });
  });

  describe('findTicketPatchBoardFieldProblems (F005)', () => {
    it('T011: a patch that touches neither priority nor board reports no priority problem', async () => {
      const fixture = await createFixture([{ name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' }]);
      const own = await insertOwnPriority(fixture, 'Own Normal', 1);

      const problems = await findTicketPatchBoardFieldProblems(
        db,
        fixture.tenantId,
        { board_id: fixture.boards['ITIL One'], priority_id: own },
        { board_id: fixture.boards['ITIL One'], priority_id: own }
      );

      expect(problems).toEqual([]);
    });

    it('T012: a patch that changes only the board is checked against the stored priority', async () => {
      const fixture = await createFixture([
        { name: 'General' },
        { name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' },
      ]);
      const own = await insertOwnPriority(fixture, 'Own Normal', 1);

      const problems = await findTicketPatchBoardFieldProblems(
        db,
        fixture.tenantId,
        { board_id: fixture.boards.General, priority_id: own },
        { board_id: fixture.boards['ITIL One'] }
      );

      expect(problems).toHaveLength(1);
      expect(problems[0].field).toBe('priority_id');
      expect(problems[0].message).toContain('ITIL One');
    });

    it('T013: a title-only patch reports no category problem on a ticket holding another board’s category', async () => {
      const fixture = await createFixture([{ name: 'General' }, { name: 'Other' }]);
      const own = await insertOwnPriority(fixture, 'Own Normal', 1);
      const foreignCategory = await insertCategory(fixture, 'Other Board Category', fixture.boards.Other);

      const problems = await findTicketPatchBoardFieldProblems(
        db,
        fixture.tenantId,
        { board_id: fixture.boards.General, priority_id: own, category_id: foreignCategory },
        {}
      );
      expect(problems).toEqual([]);

      // The same ticket, now moving boards, is checked and the category problem surfaces.
      const onMove = await findTicketPatchBoardFieldProblems(
        db,
        fixture.tenantId,
        { board_id: fixture.boards.General, priority_id: own, category_id: foreignCategory },
        { board_id: fixture.boards.Other }
      );
      expect(onMove).toEqual([]);

      const ontoThird = await findTicketPatchBoardFieldProblems(
        db,
        fixture.tenantId,
        { board_id: fixture.boards.Other, priority_id: own, category_id: foreignCategory },
        { board_id: fixture.boards.General }
      );
      expect(ontoThird.map((problem) => problem.field)).toEqual(['category_id']);
    });
  });

  describe('resolveItilPriorityId (F006)', () => {
    it('T014: finds the ITIL priority after it has been renamed', async () => {
      const fixture = await createFixture([{ name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' }]);
      const itil = await insertItilPriorities(fixture);
      await tt(fixture.tenantId, 'priorities')
        .where({ priority_id: itil[2] })
        .update({ priority_name: 'Sev-A renamed by the tenant' });

      // Impact 1 × Urgency 2 is level 2.
      await expect(resolveItilPriorityId(db, fixture.tenantId, 1, 2)).resolves.toBe(itil[2]);
    });

    it('T015: returns null when the tenant has no ITIL priority for the level', async () => {
      const fixture = await createFixture([{ name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' }]);
      await insertItilPriorities(fixture, [1, 2, 4, 5]);

      // Impact 3 × Urgency 3 is level 3, which this tenant does not have.
      await expect(resolveItilPriorityId(db, fixture.tenantId, 3, 3)).resolves.toBeNull();
      await expect(resolveItilPriorityId(db, fixture.tenantId, 0, 9)).resolves.toBeNull();
    });
  });

  describe('defaultPriorityForBoard (F007)', () => {
    it('T016: returns the stored default when it fits the board', async () => {
      const fixture = await createFixture([{ name: 'General' }]);
      const own = await insertOwnPriority(fixture, 'Own Normal', 5);
      await insertOwnPriority(fixture, 'Own Lowest Order', 1);
      await tt(fixture.tenantId, 'boards')
        .where({ board_id: fixture.boards.General })
        .update({ default_priority_id: own });

      await expect(defaultPriorityForBoard(db, fixture.tenantId, fixture.boards.General)).resolves.toBe(own);
    });

    it('T017: ignores a stored default of the wrong family and returns level 3 on an ITIL board', async () => {
      const fixture = await createFixture([{ name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' }]);
      const itil = await insertItilPriorities(fixture);
      const own = await insertOwnPriority(fixture, 'Own Normal', 1);
      await tt(fixture.tenantId, 'boards')
        .where({ board_id: fixture.boards['ITIL One'] })
        .update({ default_priority_id: own });

      await expect(defaultPriorityForBoard(db, fixture.tenantId, fixture.boards['ITIL One'])).resolves.toBe(itil[3]);
    });

    it('T018: returns the lowest-order own priority on a non-ITIL board, and null when the tenant has none', async () => {
      const fixture = await createFixture([{ name: 'General' }]);
      await insertOwnPriority(fixture, 'Own Second', 20);
      const lowest = await insertOwnPriority(fixture, 'Own First', 10);

      await expect(defaultPriorityForBoard(db, fixture.tenantId, fixture.boards.General)).resolves.toBe(lowest);

      await tt(fixture.tenantId, 'priorities').del();
      await expect(defaultPriorityForBoard(db, fixture.tenantId, fixture.boards.General)).resolves.toBeNull();
    });
  });

  describe('resolveTicketPriorityFields (F008–F010)', () => {
    it('T019: Impact and Urgency decide the priority and a supplied priority_id is ignored', async () => {
      const fixture = await createFixture([{ name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' }]);
      const itil = await insertItilPriorities(fixture);

      const resolved = await resolveTicketPriorityFields(db, fixture.tenantId, {
        boardId: fixture.boards['ITIL One'],
        priorityId: itil[5],
        itilImpact: 1,
        itilUrgency: 1,
        policy: 'refuse',
      });

      expect(resolved).toEqual({ priority_id: itil[1], itil_impact: 1, itil_urgency: 1, problems: [] });
    });

    it('T020: a priority on its own is accepted and Impact and Urgency stay empty', async () => {
      const fixture = await createFixture([{ name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' }]);
      const itil = await insertItilPriorities(fixture);

      const resolved = await resolveTicketPriorityFields(db, fixture.tenantId, {
        boardId: fixture.boards['ITIL One'],
        priorityId: itil[4],
        policy: 'refuse',
      });

      expect(resolved).toEqual({ priority_id: itil[4], itil_impact: null, itil_urgency: null, problems: [] });
    });

    it('T003: a direct priority change on an assessed ticket clears Impact and Urgency', async () => {
      const fixture = await createFixture([{ name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' }]);
      const itil = await insertItilPriorities(fixture);

      const resolved = await resolveTicketPriorityFields(db, fixture.tenantId, {
        boardId: fixture.boards['ITIL One'],
        priorityId: itil[5],
        current: { priority_id: itil[1], itil_impact: 1, itil_urgency: 1 },
        policy: 'refuse',
      });

      expect(resolved).toEqual({ priority_id: itil[5], itil_impact: null, itil_urgency: null, problems: [] });

      // Re-sending the stored priority is not a change, so the assessment stays.
      const unchanged = await resolveTicketPriorityFields(db, fixture.tenantId, {
        boardId: fixture.boards['ITIL One'],
        priorityId: itil[1],
        current: { priority_id: itil[1], itil_impact: 1, itil_urgency: 1 },
        policy: 'refuse',
      });
      expect(unchanged).toEqual({ priority_id: itil[1], itil_impact: 1, itil_urgency: 1, problems: [] });
    });

    it('T021: refuse policy rejects an own-family priority on an ITIL board', async () => {
      const fixture = await createFixture([{ name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' }]);
      await insertItilPriorities(fixture);
      const own = await insertOwnPriority(fixture, 'Own Normal', 1);

      const resolved = await resolveTicketPriorityFields(db, fixture.tenantId, {
        boardId: fixture.boards['ITIL One'],
        priorityId: own,
        policy: 'refuse',
      });

      expect(resolved.problems.map((problem) => problem.field)).toEqual(['priority_id']);
      expect(resolved.problems[0].message).toContain('Own Normal');
    });

    it('T022: fallback keeps the configured priority when it fits', async () => {
      const fixture = await createFixture([{ name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' }]);
      const itil = await insertItilPriorities(fixture);

      const resolved = await resolveTicketPriorityFields(db, fixture.tenantId, {
        boardId: fixture.boards['ITIL One'],
        priorityId: itil[2],
        policy: 'fallback',
      });

      expect(resolved).toEqual({ priority_id: itil[2], itil_impact: null, itil_urgency: null, problems: [] });
    });

    it('T023: fallback uses the board default when the configured priority does not fit', async () => {
      const fixture = await createFixture([{ name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' }]);
      const itil = await insertItilPriorities(fixture);
      const own = await insertOwnPriority(fixture, 'Own Normal', 1);
      await tt(fixture.tenantId, 'boards')
        .where({ board_id: fixture.boards['ITIL One'] })
        .update({ default_priority_id: itil[4] });

      const resolved = await resolveTicketPriorityFields(db, fixture.tenantId, {
        boardId: fixture.boards['ITIL One'],
        priorityId: own,
        policy: 'fallback',
      });

      expect(resolved).toEqual({ priority_id: itil[4], itil_impact: null, itil_urgency: null, problems: [] });
    });

    it('T024: fallback keeps the configured priority when the tenant has none of the board’s family', async () => {
      const fixture = await createFixture([{ name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' }]);
      const own = await insertOwnPriority(fixture, 'Own Normal', 1);

      const resolved = await resolveTicketPriorityFields(db, fixture.tenantId, {
        boardId: fixture.boards['ITIL One'],
        priorityId: own,
        policy: 'fallback',
      });

      expect(resolved).toEqual({ priority_id: own, itil_impact: null, itil_urgency: null, problems: [] });
    });

    it('T025: fallback with only one of Impact and Urgency drops both', async () => {
      const fixture = await createFixture([{ name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' }]);
      const itil = await insertItilPriorities(fixture);

      const resolved = await resolveTicketPriorityFields(db, fixture.tenantId, {
        boardId: fixture.boards['ITIL One'],
        priorityId: itil[2],
        itilImpact: 1,
        policy: 'fallback',
      });

      expect(resolved).toEqual({ priority_id: itil[2], itil_impact: null, itil_urgency: null, problems: [] });

      // Interactively the same write is refused rather than silently halved.
      const refused = await resolveTicketPriorityFields(db, fixture.tenantId, {
        boardId: fixture.boards['ITIL One'],
        priorityId: itil[2],
        itilImpact: 1,
        policy: 'refuse',
      });
      expect(refused.problems.map((problem) => problem.field)).toEqual(['itil_urgency']);
    });

    it('T026: a board with the tenant’s own priorities stores no Impact or Urgency', async () => {
      const fixture = await createFixture([{ name: 'General' }]);
      const own = await insertOwnPriority(fixture, 'Own Normal', 1);

      const resolved = await resolveTicketPriorityFields(db, fixture.tenantId, {
        boardId: fixture.boards.General,
        priorityId: own,
        itilImpact: 1,
        itilUrgency: 1,
        policy: 'refuse',
      });

      expect(resolved).toEqual({ priority_id: own, itil_impact: null, itil_urgency: null, problems: [] });
    });
  });

  describe('ITIL priority seeding (F011)', () => {
    it('T027: seeding twice leaves five ITIL priorities', async () => {
      const fixture = await createFixture([{ name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' }]);

      await db.transaction(async (trx) => {
        await ItilStandardsService.copyItilPrioritiesToTenant(trx, fixture.tenantId, fixture.userId);
        await ItilStandardsService.copyItilPrioritiesToTenant(trx, fixture.tenantId, fixture.userId);
      });

      const rows = await tt(fixture.tenantId, 'priorities')
        .where({ is_from_itil_standard: true, item_type: 'ticket' })
        .orderBy('itil_priority_level', 'asc');
      expect(rows.map((row: any) => row.itil_priority_level)).toEqual([1, 2, 3, 4, 5]);
    });

    it('T028: a tenant priority named like an ITIL one is reported, not flagged', async () => {
      const fixture = await createFixture([{ name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' }]);
      const standard = await db('standard_priorities')
        .where({ is_itil_standard: true, item_type: 'ticket' })
        .orderBy('itil_priority_level', 'asc')
        .first();
      expect(standard).toBeTruthy();
      const collision = await insertOwnPriority(fixture, standard.priority_name, 7);

      await expect(
        db.transaction(async (trx) => {
          await ItilStandardsService.copyItilPrioritiesToTenant(trx, fixture.tenantId, fixture.userId);
        })
      ).rejects.toThrow(new RegExp(standard.priority_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

      const row = await tt(fixture.tenantId, 'priorities').where({ priority_id: collision }).first();
      expect(row.is_from_itil_standard).toBe(false);
      expect(row.itil_priority_level).toBeNull();
    });
  });

  describe('priority write whitelist (F012)', () => {
    it('T029: create stores neither the ITIL flag nor the level, through the model and the web action', async () => {
      const fixture = await createFixture([
        { name: 'General' },
        { name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' },
      ]);

      const fromModel = await PriorityModel.insert(db, fixture.tenantId, {
        priority_name: 'Model crafted',
        order_number: 11,
        color: '#222222',
        item_type: 'ticket',
        created_by: fixture.userId,
        created_at: new Date(),
        is_from_itil_standard: true,
        itil_priority_level: 1,
      } as any);
      expect(fromModel.is_from_itil_standard).toBe(false);
      expect(fromModel.itil_priority_level).toBeNull();

      const fromAction: any = await createPriority({
        priority_name: 'Action crafted',
        order_number: 12,
        color: '#333333',
        item_type: 'ticket',
        is_from_itil_standard: true,
        itil_priority_level: 2,
      } as any);
      expect(fromAction.priority_id).toBeTruthy();
      expect(fromAction.is_from_itil_standard).toBe(false);
      expect(fromAction.itil_priority_level).toBeNull();

      // Neither row is offered by the ITIL board; both are offered by the board they belong on.
      const onItil = await listPrioritiesForBoard(db, fixture.tenantId, fixture.boards['ITIL One']);
      expect(onItil).toEqual([]);
      const onGeneral = await listPrioritiesForBoard(db, fixture.tenantId, fixture.boards.General);
      expect(onGeneral.map((priority) => priority.priority_name).sort()).toEqual(['Action crafted', 'Model crafted']);
    });

    it('T030: update cannot set or clear the ITIL flag or level', async () => {
      const fixture = await createFixture([{ name: 'General' }]);
      const own = await insertOwnPriority(fixture, 'Own Normal', 1);
      const itil = await insertItilPriorities(fixture, [3]);

      const updated: any = await updatePriority(own, {
        priority_name: 'Own Renamed',
        is_from_itil_standard: true,
        itil_priority_level: 3,
      } as any);
      expect(updated.priority_name).toBe('Own Renamed');
      expect(updated.is_from_itil_standard).toBe(false);
      expect(updated.itil_priority_level).toBeNull();

      // An ITIL row is immutable while it exists, so the flag cannot be cleared either.
      const refused: any = await updatePriority(itil[3], { is_from_itil_standard: false } as any);
      expect(refused.actionError ?? refused.message).toContain('ITIL standard priorities cannot be edited');
      const stillItil = await tt(fixture.tenantId, 'priorities').where({ priority_id: itil[3] }).first();
      expect(stillItil.is_from_itil_standard).toBe(true);
      expect(Number(stillItil.itil_priority_level)).toBe(3);
    });
  });
});
