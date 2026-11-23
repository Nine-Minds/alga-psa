/**
 * T155–T170 — F082–F091 of `ee/plans/2026-11-21-itil-remediation` (`writers-update`).
 *
 * One patch rule, `prepareTicketFieldPatch`, resolves the board-owned fields of an update against
 * the stored ticket: the priority's family, Impact × Urgency (and the D5 clearing), the category's
 * board and the subcategory's parent, translating another ITIL board's copy of a standard category
 * to the ticket's own board's copy (R2). It looks only at what the patch touches (R5), so a ticket
 * that already breaks a rule still saves every other field (D3).
 *
 * `TicketModel.updateTicket` — the workflow `tickets.update_fields` and inbound webhook update
 * path — is driven end to end. Which other writer calls the rule is pinned by
 * `server/src/test/unit/itilUpdateWritersContract.test.ts`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';

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

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { tenantDb } from '@alga-psa/db';
import { TicketModel } from '@alga-psa/shared/models/ticketModel';
import {
  findBoardFieldProblems,
  isBoardFieldRuleError,
  prepareTicketFieldPatch,
} from '@alga-psa/shared/lib/tickets/boardFieldRules';
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

function standardCategoryOnBoard(boardId: string, standardId: string): string {
  return fixture.itilCategoryIdsByBoard[boardId][standardId];
}

/** A top-level standard category and one of its children, on the first ITIL board. */
async function standardParentAndChild(): Promise<{ parentStandardId: string; childStandardId: string }> {
  const rows = await tt('categories')
    .where({ board_id: fixture.boards.itilOne })
    .whereNotNull('standard_category_id')
    .select('category_id', 'parent_category', 'standard_category_id');
  const child = rows.find((row: any) => row.parent_category);
  const parent = rows.find((row: any) => row.category_id === child.parent_category);
  return { parentStandardId: parent.standard_category_id, childStandardId: child.standard_category_id };
}

interface TicketValues {
  boardId: string;
  statusId?: string;
  priorityId?: string | null;
  categoryId?: string | null;
  subcategoryId?: string | null;
  impact?: number | null;
  urgency?: number | null;
}

/** A stored ticket, inserted directly so a row that already breaks a rule can exist (D3). */
async function insertTicket(values: TicketValues): Promise<string> {
  const ticketId = randomUUID();
  const statusKey = (Object.keys(fixture.boards) as Array<keyof ItilSecondBoardFixture['boards']>).find(
    (key) => fixture.boards[key] === values.boardId
  )!;
  await tt('tickets').insert({
    tenant: fixture.tenantId,
    ticket_id: ticketId,
    ticket_number: `T-${ticketId.slice(0, 8)}`,
    title: 'Update writer probe',
    board_id: values.boardId,
    status_id: values.statusId ?? fixture.statuses[statusKey],
    priority_id: values.priorityId ?? fixture.itilPriorityIds[3],
    category_id: values.categoryId ?? null,
    subcategory_id: values.subcategoryId ?? null,
    itil_impact: values.impact ?? null,
    itil_urgency: values.urgency ?? null,
    client_id: fixture.clientId,
    entered_by: fixture.userId,
    entered_at: new Date().toISOString(),
  });
  return ticketId;
}

async function storedTicket(ticketId: string) {
  return tt('tickets')
    .where({ ticket_id: ticketId })
    .first('title', 'board_id', 'status_id', 'priority_id', 'category_id', 'subcategory_id', 'itil_impact', 'itil_urgency');
}

/** The stored ticket in the shape the rule takes as `current`. */
async function current(ticketId: string) {
  return tt('tickets')
    .where({ ticket_id: ticketId })
    .first('board_id', 'priority_id', 'category_id', 'subcategory_id', 'itil_impact', 'itil_urgency');
}

describe('ITIL update writers (integration)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection({ runSeeds: false });
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    if (!fixture) return;
    await tt('ticket_watchers').del();
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

  describe('the patch rule (F082)', () => {
    it('T155: a patch that touches none of the six fields is returned unchanged, without asking the database', async () => {
      // No connection is passed: a patch that touches nothing must not read anything (R5).
      const patch: Record<string, unknown> = { title: 'Renamed', status_id: 'status-1', assigned_to: 'user-1' };
      const problems = await prepareTicketFieldPatch(
        null as unknown as Knex,
        'tenant-1',
        { board_id: 'board-1', priority_id: 'priority-1', category_id: 'category-1' },
        patch as any
      );
      expect(problems).toEqual([]);
      expect(patch).toEqual({ title: 'Renamed', status_id: 'status-1', assigned_to: 'user-1' });

      // The same holds for a patch that re-sends the stored values, which is what the ticket form posts.
      const resend: Record<string, unknown> = { board_id: 'board-1', priority_id: 'priority-1', category_id: 'category-1' };
      expect(
        await prepareTicketFieldPatch(
          null as unknown as Knex,
          'tenant-1',
          { board_id: 'board-1', priority_id: 'priority-1', category_id: 'category-1' },
          resend as any
        )
      ).toEqual([]);
      expect(resend).toEqual({ board_id: 'board-1', priority_id: 'priority-1', category_id: 'category-1' });
    });

    it('T156: a category from another board is refused on the second ITIL board', async () => {
      await withFixture();
      const ticketId = await insertTicket({ boardId: fixture.boards.itilTwo });

      const patch: Record<string, unknown> = { category_id: fixture.ownCategory.parentId };
      const problems = await prepareTicketFieldPatch(db, fixture.tenantId, await current(ticketId), patch as any);
      expect(problems.map((problem) => problem.field)).toEqual(['category_id']);
      expect(problems[0].message).toContain('ITIL Two');

      // `Board-only extra` belongs to ITIL Two, so a ticket of ITIL One cannot take it either.
      const onBoardOne = await insertTicket({ boardId: fixture.boards.itilOne });
      const foreign: Record<string, unknown> = { category_id: fixture.itilTwoOwnCategoryId };
      expect(
        (await prepareTicketFieldPatch(db, fixture.tenantId, await current(onBoardOne), foreign as any)).map(
          (problem) => problem.field
        )
      ).toEqual(['category_id']);
    }, HOOK_TIMEOUT);

    it('T157: a subcategory that is not a child of the category is refused against the subcategory', async () => {
      await withFixture();
      const { parentStandardId, childStandardId } = await standardParentAndChild();
      const ticketId = await insertTicket({ boardId: fixture.boards.itilTwo });

      // A standard child of another parent: the REST update accepted this before.
      const otherParentStandardId = Object.keys(fixture.itilCategoryIdsByBoard[fixture.boards.itilTwo]).find(
        (standardId) => standardId !== parentStandardId && standardId !== childStandardId
      )!;
      const patch: Record<string, unknown> = {
        category_id: standardCategoryOnBoard(fixture.boards.itilTwo, otherParentStandardId),
        subcategory_id: standardCategoryOnBoard(fixture.boards.itilTwo, childStandardId),
      };
      const problems = await prepareTicketFieldPatch(db, fixture.tenantId, await current(ticketId), patch as any);
      expect(problems.map((problem) => problem.field)).toEqual(['subcategory_id']);
    }, HOOK_TIMEOUT);

    it('T158: a priority on its own clears Impact and Urgency on an assessed ITIL ticket (D5)', async () => {
      await withFixture();
      const ticketId = await insertTicket({
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.itilPriorityIds[2],
        impact: 2,
        urgency: 2,
      });

      const patch: Record<string, unknown> = { priority_id: fixture.itilPriorityIds[5] };
      expect(await prepareTicketFieldPatch(db, fixture.tenantId, await current(ticketId), patch as any)).toEqual([]);
      expect(patch).toEqual({
        priority_id: fixture.itilPriorityIds[5],
        itil_impact: null,
        itil_urgency: null,
      });
    }, HOOK_TIMEOUT);

    it('T240: a patch that empties both halves clears the assessment and keeps the priority', async () => {
      await withFixture();
      const ticketId = await insertTicket({
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.itilPriorityIds[2],
        impact: 2,
        urgency: 2,
      });

      // An explicit clear: both halves are named and empty. The ticket becomes "Not assessed" and
      // keeps the priority it had — the stored pair must not be handed back.
      const patch: Record<string, unknown> = { itil_impact: null, itil_urgency: null };
      expect(await prepareTicketFieldPatch(db, fixture.tenantId, await current(ticketId), patch as any)).toEqual([]);
      // The priority the ticket already holds is kept, so the patch stays as small as it arrived.
      expect(patch).toEqual({ itil_impact: null, itil_urgency: null });

      // Only one half is still refused: a half-assessed ticket is not a thing (R4).
      const half: Record<string, unknown> = { itil_impact: null };
      expect(
        (await prepareTicketFieldPatch(db, fixture.tenantId, await current(ticketId), half as any)).map(
          (problem) => problem.field
        )
      ).toEqual(['itil_impact']);
    }, HOOK_TIMEOUT);

    it('T163: a move to a board of the other priority family needs a fitting priority, and clears the assessment', async () => {
      await withFixture();
      const ticketId = await insertTicket({
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.itilPriorityIds[1],
        impact: 1,
        urgency: 1,
      });

      const refused: Record<string, unknown> = { board_id: fixture.boards.own, status_id: fixture.statuses.own };
      const problems = await prepareTicketFieldPatch(db, fixture.tenantId, await current(ticketId), refused as any);
      expect(problems.map((problem) => problem.field)).toEqual(['priority_id']);

      const accepted: Record<string, unknown> = {
        board_id: fixture.boards.own,
        status_id: fixture.statuses.own,
        priority_id: fixture.ownPriorityIds[1],
      };
      expect(await prepareTicketFieldPatch(db, fixture.tenantId, await current(ticketId), accepted as any)).toEqual([]);
      expect(accepted).toMatchObject({
        priority_id: fixture.ownPriorityIds[1],
        itil_impact: null,
        itil_urgency: null,
      });
    }, HOOK_TIMEOUT);

    it('T165: a move between two ITIL boards keeps the category and subcategory by meaning', async () => {
      await withFixture();
      const { parentStandardId, childStandardId } = await standardParentAndChild();
      const ticketId = await insertTicket({
        boardId: fixture.boards.itilOne,
        categoryId: standardCategoryOnBoard(fixture.boards.itilOne, parentStandardId),
        subcategoryId: standardCategoryOnBoard(fixture.boards.itilOne, childStandardId),
      });

      const patch: Record<string, unknown> = {
        board_id: fixture.boards.itilTwo,
        status_id: fixture.statuses.itilTwo,
      };
      expect(await prepareTicketFieldPatch(db, fixture.tenantId, await current(ticketId), patch as any)).toEqual([]);
      expect(patch).toMatchObject({
        category_id: standardCategoryOnBoard(fixture.boards.itilTwo, parentStandardId),
        subcategory_id: standardCategoryOnBoard(fixture.boards.itilTwo, childStandardId),
      });

      // Same names, different rows: the move changed the ids, not the meaning.
      const names = async (categoryId: string) =>
        (await tt('categories').where({ category_id: categoryId }).first('category_name')).category_name;
      expect(await names(patch.category_id as string)).toBe(
        await names(standardCategoryOnBoard(fixture.boards.itilOne, parentStandardId))
      );
      expect(await names(patch.subcategory_id as string)).toBe(
        await names(standardCategoryOnBoard(fixture.boards.itilOne, childStandardId))
      );
    }, HOOK_TIMEOUT);

    it('T166: any other board move clears a category the patch did not name', async () => {
      await withFixture();
      const ticketId = await insertTicket({
        boardId: fixture.boards.own,
        priorityId: fixture.ownPriorityIds[0],
        categoryId: fixture.ownCategory.parentId,
        subcategoryId: fixture.ownCategory.childId,
      });

      // `Legacy Mixed` keeps the tenant's own categories, so the old board's category has no
      // counterpart there and nothing can translate it: it is cleared, not refused.
      const patch: Record<string, unknown> = {
        board_id: fixture.boards.mixed,
        status_id: fixture.statuses.mixed,
        priority_id: fixture.itilPriorityIds[3],
      };
      expect(await prepareTicketFieldPatch(db, fixture.tenantId, await current(ticketId), patch as any)).toEqual([]);
      expect(patch).toMatchObject({ category_id: null, subcategory_id: null });
    }, HOOK_TIMEOUT);

    it('T167, T168: a ticket that already breaks a rule saves a title, status, assignee and description change', async () => {
      await withFixture();
      // The two shapes the migration and history leave behind: a priority of the other family, and
      // a category that belongs to another board.
      const wrongPriority = await insertTicket({
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.ownPriorityIds[0],
      });
      const foreignCategory = await insertTicket({
        boardId: fixture.boards.itilTwo,
        categoryId: fixture.ownCategory.parentId,
      });

      for (const ticketId of [wrongPriority, foreignCategory]) {
        const patch: Record<string, unknown> = {
          title: 'Renamed by an unrelated edit',
          status_id: fixture.statuses.itilTwo,
          assigned_to: fixture.userId,
          attributes: { description: 'Edited' },
        };
        expect(
          await prepareTicketFieldPatch(db, fixture.tenantId, await current(ticketId), patch as any),
          'an unrelated edit is not refused'
        ).toEqual([]);
        expect(Object.keys(patch).sort()).toEqual(['assigned_to', 'attributes', 'status_id', 'title']);
      }
    }, HOOK_TIMEOUT);

    it('T170: an update naming another ITIL board’s standard category stores this board’s copy', async () => {
      await withFixture();
      const { parentStandardId } = await standardParentAndChild();
      const ticketId = await insertTicket({ boardId: fixture.boards.itilTwo });

      // The shape a REST caller holding the first board's id sends.
      const patch: Record<string, unknown> = {
        category_id: standardCategoryOnBoard(fixture.boards.itilOne, parentStandardId),
      };
      expect(await prepareTicketFieldPatch(db, fixture.tenantId, await current(ticketId), patch as any)).toEqual([]);
      expect(patch.category_id).toBe(standardCategoryOnBoard(fixture.boards.itilTwo, parentStandardId));
    }, HOOK_TIMEOUT);

    it('T164: every ticket of a bulk move across families is refused on its own', async () => {
      await withFixture();
      const ticketIds = [
        await insertTicket({ boardId: fixture.boards.itilOne }),
        await insertTicket({ boardId: fixture.boards.itilTwo }),
      ];

      for (const ticketId of ticketIds) {
        const patch: Record<string, unknown> = {
          board_id: fixture.boards.own,
          status_id: fixture.statuses.own,
        };
        const problems = await prepareTicketFieldPatch(db, fixture.tenantId, await current(ticketId), patch as any);
        expect(problems.map((problem) => problem.field)).toEqual(['priority_id']);
      }

      // None of them moved: the rule runs before the write, and the bulk action reports per ticket.
      const boards = await tt('tickets').whereIn('ticket_id', ticketIds).pluck('board_id');
      expect(boards.sort()).toEqual([fixture.boards.itilOne, fixture.boards.itilTwo].sort());
    }, HOOK_TIMEOUT);
  });

  describe('TicketModel.updateTicket — workflow update_fields and the inbound webhook update (F085)', () => {
    async function modelUpdate(ticketId: string, patch: Record<string, unknown>) {
      return db.transaction((trx) =>
        TicketModel.updateTicket(ticketId, patch as any, fixture.tenantId, trx, {}, undefined, undefined, fixture.userId)
      );
    }

    it('T159: a wrong-family priority fails with a field error and writes nothing', async () => {
      await withFixture();
      const ticketId = await insertTicket({ boardId: fixture.boards.itilTwo });

      const error = await modelUpdate(ticketId, { priority_id: fixture.ownPriorityIds[0] }).catch((caught) => caught);
      expect(isBoardFieldRuleError(error)).toBe(true);
      expect(error.field).toBe('priority_id');
      expect(await storedTicket(ticketId)).toMatchObject({ priority_id: fixture.itilPriorityIds[3] });
    }, HOOK_TIMEOUT);

    it('T160: a board change without a fitting priority is refused', async () => {
      await withFixture();
      const ticketId = await insertTicket({ boardId: fixture.boards.itilTwo });

      const error = await modelUpdate(ticketId, {
        board_id: fixture.boards.own,
        status_id: fixture.statuses.own,
      }).catch((caught) => caught);
      expect(isBoardFieldRuleError(error)).toBe(true);
      expect(error.field).toBe('priority_id');
      expect(await storedTicket(ticketId)).toMatchObject({ board_id: fixture.boards.itilTwo });
    }, HOOK_TIMEOUT);

    it('T169: a fixed standard category sets each ticket’s own board’s copy', async () => {
      await withFixture();
      const { parentStandardId } = await standardParentAndChild();
      const held = standardCategoryOnBoard(fixture.boards.itilOne, parentStandardId);

      // The same configured category id, on tickets of two different ITIL boards.
      const onBoardOne = await insertTicket({ boardId: fixture.boards.itilOne });
      const onBoardTwo = await insertTicket({ boardId: fixture.boards.itilTwo });

      await modelUpdate(onBoardOne, { category_id: held });
      await modelUpdate(onBoardTwo, { category_id: held });

      expect(await storedTicket(onBoardOne)).toMatchObject({ category_id: held });
      expect(await storedTicket(onBoardTwo)).toMatchObject({
        category_id: standardCategoryOnBoard(fixture.boards.itilTwo, parentStandardId),
      });
    }, HOOK_TIMEOUT);

    it('T240: an update that empties both halves stores "Not assessed" and keeps the priority', async () => {
      await withFixture();
      const ticketId = await insertTicket({
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.itilPriorityIds[2],
        impact: 2,
        urgency: 2,
      });

      await modelUpdate(ticketId, { itil_impact: null, itil_urgency: null });
      expect(await storedTicket(ticketId)).toMatchObject({
        itil_impact: null,
        itil_urgency: null,
        priority_id: fixture.itilPriorityIds[2],
      });
    }, HOOK_TIMEOUT);

    it('T167: an unrelated edit still saves on a ticket whose stored priority does not fit its board', async () => {
      await withFixture();
      const ticketId = await insertTicket({
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.ownPriorityIds[0],
        categoryId: fixture.ownCategory.parentId,
      });

      await modelUpdate(ticketId, { title: 'Renamed through the model', assigned_to: fixture.userId });
      expect(await storedTicket(ticketId)).toMatchObject({
        title: 'Renamed through the model',
        // Untouched: nothing rewrites a ticket silently (D3).
        priority_id: fixture.ownPriorityIds[0],
        category_id: fixture.ownCategory.parentId,
      });
    }, HOOK_TIMEOUT);
  });

  describe('the Activities inline priority picker (F086)', () => {
    it('T161: both action variants refuse a priority that does not fit the ticket’s board', async () => {
      await withFixture();
      const ticketId = await insertTicket({ boardId: fixture.boards.itilTwo });
      const { updateActivityPriority, updateActivityPriorityById } = await import(
        '../../../../packages/user-activities/src/actions/activityStatusActions'
      );
      const { ActivityType } = await import('../../../../packages/types/src/interfaces/activity.interfaces');

      await expect(
        updateActivityPriorityById(ticketId, ActivityType.TICKET, fixture.ownPriorityIds[0])
      ).rejects.toThrow(/ITIL Two/);
      await expect(
        updateActivityPriority(ticketId, ActivityType.TICKET, 'Own Low')
      ).rejects.toThrow(/ITIL Two/);

      expect(await storedTicket(ticketId)).toMatchObject({ priority_id: fixture.itilPriorityIds[3] });
    }, HOOK_TIMEOUT);

    it('T161: a fitting priority is written, and a direct change clears the assessment (D5)', async () => {
      await withFixture();
      const ticketId = await insertTicket({
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.itilPriorityIds[2],
        impact: 2,
        urgency: 2,
      });
      const { updateActivityPriorityById } = await import(
        '../../../../packages/user-activities/src/actions/activityStatusActions'
      );
      const { ActivityType } = await import('../../../../packages/types/src/interfaces/activity.interfaces');

      await updateActivityPriorityById(ticketId, ActivityType.TICKET, fixture.itilPriorityIds[5]);
      expect(await storedTicket(ticketId)).toMatchObject({
        priority_id: fixture.itilPriorityIds[5],
        itil_impact: null,
        itil_urgency: null,
      });
    }, HOOK_TIMEOUT);
  });

  describe('bundle sync (F087)', () => {
    it('T162: the master’s priority reaches a child of the same family and not one of the other', async () => {
      await withFixture();
      // Bundle sync decides per child board, which is the question the shared rule answers.
      const itilChildBoard = fixture.boards.itilTwo;
      const ownChildBoard = fixture.boards.own;
      const masterPriorityId = fixture.itilPriorityIds[1];

      await expect(
        findBoardFieldProblems(db, fixture.tenantId, { boardId: itilChildBoard, priorityId: masterPriorityId })
      ).resolves.toEqual([]);
      const refused = await findBoardFieldProblems(db, fixture.tenantId, {
        boardId: ownChildBoard,
        priorityId: masterPriorityId,
      });
      expect(refused.map((problem) => problem.field)).toEqual(['priority_id']);
    }, HOOK_TIMEOUT);
  });
});
