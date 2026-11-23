/**
 * T043–T044 — F020–F021 of `ee/plans/2026-11-21-itil-remediation` (`test-harness`).
 *
 * One table of every picker and writer the PRD names, run against a tenant with two ITIL boards.
 * A row is `covered` once its commit group has landed and carries a probe that must pass on the
 * *second* ITIL board; until then it is `expected-fail` and names the group that will fix it.
 *
 * Two things keep the table honest:
 *
 * - every surface named in the PRD's refuse/fall-back table and in the SCRATCHPAD's traced-pickers
 *   table has to be claimed by exactly one row (T044), so adding a surface to the plan without a
 *   row fails here;
 * - the set of groups still `expected-fail` has to equal the set of groups still unimplemented in
 *   `features.json`, so flipping a group to implemented without flipping its rows fails here too.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';

// Probes call the real server actions, so the two seams every action goes through are pointed at
// the suite's connection and the fixture's user.
const dbRef = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '' }));
const userRef = vi.hoisted(() => ({ user: null as any }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
  preCheckDeletion: vi.fn(async () => ({ allowed: true })),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

// Some actions import the narrow entry point rather than the package barrel.
vi.mock('@alga-psa/auth/withAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth/withAuth')>()),
  withAuth: (action: any) => (...args: any[]) => action(userRef.user, { tenant: dbRef.tenant }, ...args),
}));

// Probes call server actions outside a request, where `revalidatePath` has no store.
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { tenantDb } from '@alga-psa/db';
import {
  defaultPriorityForBoard,
  findBoardFieldProblems,
  listPrioritiesForBoard,
  prepareTicketCreateFields,
  prepareTicketFieldPatch,
  resolveTicketPriorityFields,
} from '@alga-psa/shared/lib/tickets/boardFieldRules';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  cleanupItilSecondBoardFixture,
  createItilSecondBoardFixture,
  expectedItilCategoryOwnership,
  type ItilSecondBoardFixture,
} from './fixtures/itilSecondBoardFixture';

const HOOK_TIMEOUT = 180_000;
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const PLAN_DIR = path.resolve(REPO_ROOT, 'ee/plans/2026-11-21-itil-remediation');

type CommitGroup =
  | 'core-rules'
  | 'email-hotfix'
  | 'test-harness'
  | 'category-schema'
  | 'category-rules'
  | 'category-filters'
  | 'impact-urgency'
  | 'writers-create'
  | 'writers-update'
  | 'priority-pickers'
  | 'board-lifecycle'
  | 'board-type-switch'
  | 'sla'
  | 'cleanup'
  | 'guard'
  | 'docs';

interface Surface {
  /** The name used in the plan documents. */
  surface: string;
  /** The group whose commit makes this surface correct on a second ITIL board. */
  commitGroup: CommitGroup;
  /** The plan-document tokens this row claims (T044). */
  claims: string[];
  /** Present once the row is covered: must pass against the second ITIL board. */
  probe?: (db: Knex, fixture: ItilSecondBoardFixture) => Promise<void>;
  /** Present while the row is expected to fail: what is wrong today. */
  expectedFail?: string;
}

/** A ticket on one board, for the probes that need the predicate engine to look at a real row. */
async function insertProbeTicket(
  db: Knex,
  fixture: ItilSecondBoardFixture,
  boardId: string,
  values: { categoryId?: string | null } = {}
): Promise<string> {
  const ticketId = randomUUID();
  const statusId = Object.entries(fixture.boards).find(([, id]) => id === boardId)![0] as keyof ItilSecondBoardFixture['statuses'];
  await tenantDb(db, fixture.tenantId).table('tickets').insert({
    tenant: fixture.tenantId,
    ticket_id: ticketId,
    ticket_number: `T-${ticketId.slice(0, 8)}`,
    title: 'Surface probe ticket',
    board_id: boardId,
    status_id: fixture.statuses[statusId],
    priority_id: fixture.itilPriorityIds[3],
    client_id: fixture.clientId,
    category_id: values.categoryId ?? null,
    entered_by: fixture.userId,
    entered_at: new Date().toISOString(),
  });
  return ticketId;
}

const SURFACES: Surface[] = [
  {
    surface: 'Shared board field rules',
    commitGroup: 'core-rules',
    claims: [],
    probe: async (db, fixture) => {
      const [onOne, onTwo] = await Promise.all([
        listPrioritiesForBoard(db, fixture.tenantId, fixture.boards.itilOne),
        listPrioritiesForBoard(db, fixture.tenantId, fixture.boards.itilTwo),
      ]);
      expect(onTwo.map((priority) => priority.priority_id)).toEqual(
        onOne.map((priority) => priority.priority_id)
      );
      expect(onTwo).toHaveLength(Object.keys(fixture.itilPriorityIds).length);

      // The second ITIL board refuses the tenant's own priority and accepts the ITIL family,
      // and its default is the level-3 ITIL priority (R7).
      const refused = await findBoardFieldProblems(db, fixture.tenantId, {
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.ownPriorityIds[0],
      });
      expect(refused.map((problem) => problem.field)).toEqual(['priority_id']);
      expect(refused[0].message).toContain('ITIL Two');
      await expect(defaultPriorityForBoard(db, fixture.tenantId, fixture.boards.itilTwo)).resolves.toBe(
        fixture.itilPriorityIds[3]
      );
    },
  },
  {
    surface: 'Inbound email defaults',
    commitGroup: 'email-hotfix',
    claims: ['Inbound email defaults'],
    probe: async (db, fixture) => {
      const { getPrioritiesByBoardType } = await import(
        '../../../../packages/reference-data/src/actions/priorityActions'
      );
      const offered = (await getPrioritiesByBoardType(fixture.boards.itilTwo, 'ticket')) as any[];
      expect(offered.map((priority) => priority.priority_id).sort()).toEqual(
        Object.values(fixture.itilPriorityIds).sort()
      );
    },
  },
  {
    surface: 'Inbound email',
    commitGroup: 'email-hotfix',
    claims: ['Inbound email'],
    probe: async (db, fixture) => {
      // A defaults row left on the second ITIL board with the tenant's own priority: the email
      // still becomes a ticket, with the board's default priority.
      const resolved = await resolveTicketPriorityFields(db, fixture.tenantId, {
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.ownPriorityIds[0],
        policy: 'fallback',
      });
      expect(resolved.problems).toEqual([]);
      expect(resolved.priority_id).toBe(fixture.itilPriorityIds[3]);
    },
  },
  {
    surface: 'Categories settings',
    commitGroup: 'category-rules',
    claims: ['Categories settings'],
    probe: async (db, fixture) => {
      const { getAllCategories } = await import('../../../../packages/tickets/src/actions/ticketCategoryActions');
      const all = (await getAllCategories()) as any[];
      const onTwo = all.filter((category) => category.board_id === fixture.boards.itilTwo);
      // The screen badges a standard row and disables its edit and delete, so the flag and the
      // standard link have to travel with the row.
      expect(onTwo.filter((category) => category.standard_category_id)).toHaveLength(
        Object.keys(fixture.itilCategoryIdsByBoard[fixture.boards.itilTwo]).length
      );
      expect(onTwo.every((category) => 'is_from_itil_standard' in category)).toBe(true);
    },
  },
  {
    surface: 'Main ticket category picker',
    commitGroup: 'category-rules',
    claims: [],
    probe: async (db, fixture) => {
      const { getTicketCategoriesByBoard } = await import('../../../../packages/tickets/src/actions/ticketCategoryActions');
      const onOne = (await getTicketCategoriesByBoard(fixture.boards.itilOne)) as any;
      const onTwo = (await getTicketCategoriesByBoard(fixture.boards.itilTwo)) as any;
      const names = (result: any) => result.categories.map((category: any) => category.category_name).sort();
      // The same set by name on both boards, different rows, and each offered value passes the
      // server's own check on that board.
      expect(names(onTwo)).toEqual([...names(onOne), 'Board-only extra'].sort());
      expect(
        onTwo.categories.every((category: any) => category.board_id === fixture.boards.itilTwo)
      ).toBe(true);
      for (const category of onTwo.categories.filter((row: any) => !row.parent_category)) {
        await expect(
          findBoardFieldProblems(db, fixture.tenantId, {
            boardId: fixture.boards.itilTwo,
            categoryId: category.category_id,
          })
        ).resolves.toEqual([]);
      }
    },
  },
  {
    surface: 'REST `/categories/ticket`, tree, search',
    commitGroup: 'category-rules',
    claims: ['REST `/categories/ticket`, tree, search'],
    probe: async (db, fixture) => {
      const rows = await tenantDb(db, fixture.tenantId)
        .table('categories')
        .where({ board_id: fixture.boards.itilTwo })
        .select('category_id');
      // CategoryService, the tree and the search all filter by board_id; with a per-board copy
      // that is now the whole set, where before the second ITIL board returned nothing.
      expect(rows.length).toBe(
        Object.keys(fixture.itilCategoryIdsByBoard[fixture.boards.itilTwo]).length + 1
      );
    },
  },
  {
    surface: 'Templates and recurring schedules',
    commitGroup: 'category-rules',
    claims: ['Templates', 'recurring schedules'],
    probe: async (db, fixture) => {
      const { findTicketFieldReferenceProblems } = await import('../../../../packages/tickets/src/lib/ticketFieldReferences');
      const standardIds = fixture.itilCategoryIdsByBoard[fixture.boards.itilTwo];
      const parent = await tenantDb(db, fixture.tenantId)
        .table('categories')
        .where({ board_id: fixture.boards.itilTwo })
        .whereNull('parent_category')
        .whereNotNull('standard_category_id')
        .first('category_id');
      const child = await tenantDb(db, fixture.tenantId)
        .table('categories')
        .where({ board_id: fixture.boards.itilTwo, parent_category: parent.category_id })
        .first('category_id');
      expect(Object.keys(standardIds).length).toBeGreaterThan(0);
      await expect(
        findTicketFieldReferenceProblems(db, fixture.tenantId, {
          fields: {
            board_id: fixture.boards.itilTwo,
            status_id: fixture.statuses.itilTwo,
            priority_id: fixture.itilPriorityIds[3],
            category_id: parent.category_id,
            subcategory_id: child?.category_id ?? null,
          },
          schedule: true,
        })
      ).resolves.toEqual([]);
    },
  },
  {
    surface: 'Co-managed ticket edit categories',
    commitGroup: 'category-rules',
    claims: ['Co-managed ticket edit'],
    probe: async (db, fixture) => {
      // The co-managed edit checks a category through the shared rule, so the second ITIL board's
      // own copy is accepted and the first board's copy of the same standard row is not.
      const onTwo = Object.values(fixture.itilCategoryIdsByBoard[fixture.boards.itilTwo])[0];
      const onOne = Object.values(fixture.itilCategoryIdsByBoard[fixture.boards.itilOne])[0];
      const parentOnTwo = await tenantDb(db, fixture.tenantId)
        .table('categories')
        .where({ board_id: fixture.boards.itilTwo })
        .whereNull('parent_category')
        .first('category_id');
      await expect(
        findBoardFieldProblems(db, fixture.tenantId, {
          boardId: fixture.boards.itilTwo,
          categoryId: parentOnTwo.category_id,
        })
      ).resolves.toEqual([]);
      expect(onTwo).not.toBe(onOne);
      const refused = await findBoardFieldProblems(db, fixture.tenantId, {
        boardId: fixture.boards.itilTwo,
        categoryId: onOne,
      });
      expect(refused.map((problem) => problem.field)).toContain('category_id');
    },
  },
  {
    surface: 'Co-managed ticket edit priorities',
    commitGroup: 'priority-pickers',
    claims: ['co-managed edit'],
    probe: async (db, fixture) => {
      // The collaborator's option search asks the same question the write does: the board's family.
      const offered = await listPrioritiesForBoard(db, fixture.tenantId, fixture.boards.itilTwo, 'ticket');
      expect(offered.map((priority) => priority.priority_id).sort()).toEqual(
        Object.values(fixture.itilPriorityIds).sort()
      );
      const refused = await findBoardFieldProblems(db, fixture.tenantId, {
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.ownPriorityIds[0],
      });
      expect(refused.map((problem) => problem.field)).toEqual(['priority_id']);
    },
  },
  {
    surface: 'Checklist apply rules',
    commitGroup: 'category-filters',
    claims: ['Checklist apply rules'],
    probe: async (db, fixture) => {
      const { createTicketQuerySchema } = await import('@alga-psa/shared/lib/ticketQuery/ticketQuerySchema');
      const { compilePredicateFragment } = await import('@alga-psa/predicates/sql');
      // A rule naming the first ITIL board's copy, with no board of its own, matches a ticket
      // holding the second board's copy of the same standard category (R9).
      const onOne = Object.entries(fixture.itilCategoryIdsByBoard[fixture.boards.itilOne]);
      const [standardId, categoryOnOne] = onOne[0];
      const categoryOnTwo = fixture.itilCategoryIdsByBoard[fixture.boards.itilTwo][standardId];
      const ticketId = await insertProbeTicket(db, fixture, fixture.boards.itilTwo, {
        categoryId: categoryOnTwo,
      });
      const fragment = compilePredicateFragment(
        createTicketQuerySchema(() => new Date().toISOString()),
        { join: 'and', clauses: [{ path: 'category_id', operator: 'equals', value: categoryOnOne }] } as any,
        { rootAlias: 't' }
      );
      const row = (await tenantDb(db, fixture.tenantId)
        .table('tickets as t')
        .where('t.ticket_id', ticketId)
        .select(db.raw(`(${fragment.sql}) AS ??`, [...(fragment.bindings as any[]), 'matched']))
        .first()) as { matched: boolean };
      expect(row.matched).toBe(true);
    },
  },
  {
    surface: 'All-boards and client portal category filters',
    commitGroup: 'category-filters',
    claims: [],
    probe: async (db, fixture) => {
      const { standardCategoryFilterOptions } = await import('@alga-psa/shared/lib/tickets/standardCategoryFilterOptions');
      const rows = await tenantDb(db, fixture.tenantId)
        .table('categories')
        .orderBy('display_order', 'asc')
        .orderBy('category_name', 'asc')
        .select('category_id', 'category_name', 'board_id', 'parent_category', 'standard_category_id');
      const { categories, aliases } = standardCategoryFilterOptions(rows as any[]);
      const standardCount = Object.keys(fixture.itilCategoryIdsByBoard[fixture.boards.itilOne]).length;
      // One entry per standard category, plus the tenant's own two and ITIL Two's extra.
      expect(categories).toHaveLength(standardCount + 3);
      expect(Object.keys(aliases)).toHaveLength(standardCount);
    },
  },
  {
    surface: 'Saved list views',
    commitGroup: 'category-filters',
    claims: [],
    probe: async (db, fixture) => {
      const { standardCategoryFilterOptions } = await import('@alga-psa/shared/lib/tickets/standardCategoryFilterOptions');
      const { validateCapturedFilters } = await import('../../../../packages/tickets/src/lib/ticketViewSettings');
      const rows = await tenantDb(db, fixture.tenantId)
        .table('categories')
        .select('category_id', 'category_name', 'board_id', 'parent_category', 'standard_category_id');
      const { categories, aliases } = standardCategoryFilterOptions(rows as any[]);
      const storedId = Object.keys(aliases)[0];
      const validated = validateCapturedFilters(
        { categoryIds: [storedId] },
        { categoryIds: categories.map((category: any) => category.category_id), categoryAliases: aliases }
      );
      expect(validated.categoryIds).toEqual([aliases[storedId]]);
    },
  },
  {
    surface: 'Impact × Urgency on MSP create and update',
    commitGroup: 'impact-urgency',
    claims: ['MSP create and update'],
    probe: async (db, fixture) => {
      const { resolveTicketPriorityFieldsOrThrow, prepareTicketFieldPatchOrThrow } = await import(
        '../../../../packages/tickets/src/lib/ticketFieldReferences'
      );

      // A create on the second ITIL board: Impact × Urgency decides the priority, by level.
      const created = await resolveTicketPriorityFieldsOrThrow(db, fixture.tenantId, {
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.itilPriorityIds[5],
        itilImpact: 1,
        itilUrgency: 2,
        policy: 'refuse',
      });
      expect(created.priority_id).toBe(fixture.itilPriorityIds[2]);
      expect([created.itil_impact, created.itil_urgency]).toEqual([1, 2]);

      // The same answer on the first ITIL board: the rule is the board's kind, not its identity.
      const onOne = await resolveTicketPriorityFieldsOrThrow(db, fixture.tenantId, {
        boardId: fixture.boards.itilOne,
        priorityId: fixture.itilPriorityIds[5],
        itilImpact: 1,
        itilUrgency: 2,
        policy: 'refuse',
      });
      expect(onOne.priority_id).toBe(created.priority_id);

      // An update that only moves the priority clears the assessment (D5).
      const patch: Record<string, unknown> = { priority_id: fixture.itilPriorityIds[4] };
      await prepareTicketFieldPatchOrThrow(
        db,
        fixture.tenantId,
        {
          board_id: fixture.boards.itilTwo,
          priority_id: fixture.itilPriorityIds[1],
          itil_impact: 1,
          itil_urgency: 1,
        },
        patch,
        'refuse'
      );
      expect(patch).toEqual({
        priority_id: fixture.itilPriorityIds[4],
        itil_impact: null,
        itil_urgency: null,
      });
    },
  },
  {
    surface: 'Service request provider',
    commitGroup: 'impact-urgency',
    claims: ['Service request provider'],
    probe: async (db, fixture) => {
      // The provider's policy is fall-back (R6) and its lookup is by level, so a configured pair
      // resolves on the second ITIL board exactly as on the first.
      const resolved = await resolveTicketPriorityFields(db, fixture.tenantId, {
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.ownPriorityIds[0],
        itilImpact: 3,
        itilUrgency: 4,
        policy: 'fallback',
      });
      expect(resolved.problems).toEqual([]);
      expect(resolved.priority_id).toBe(fixture.itilPriorityIds[4]);
      expect([resolved.itil_impact, resolved.itil_urgency]).toEqual([3, 4]);
    },
  },
  {
    surface: 'Service request editor',
    commitGroup: 'priority-pickers',
    claims: ['Service request editor'],
    probe: async (db, fixture) => {
      // Both kinds: the editor lists the board's own family, never every ticket priority.
      const onOwn = await listPrioritiesForBoard(db, fixture.tenantId, fixture.boards.own, 'ticket');
      expect(onOwn.map((priority) => priority.priority_id).sort()).toEqual([...fixture.ownPriorityIds].sort());
      const onTwo = await listPrioritiesForBoard(db, fixture.tenantId, fixture.boards.itilTwo, 'ticket');
      expect(onTwo.map((priority) => priority.priority_id).sort()).toEqual(
        Object.values(fixture.itilPriorityIds).sort()
      );
    },
  },
  {
    surface: 'Client portal create',
    commitGroup: 'writers-create',
    claims: ['Client portal create'],
    probe: async (db, fixture) => {
      // A refuse path: the portal's own board resolution can land on an ITIL board, and the
      // priority the requester picked is checked against it before anything is written.
      const refused = await prepareTicketCreateFields(db, fixture.tenantId, {
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.ownPriorityIds[0],
        policy: 'refuse',
      });
      expect(refused.problems.map((problem) => problem.field)).toEqual(['priority_id']);

      const accepted = await prepareTicketCreateFields(db, fixture.tenantId, {
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.itilPriorityIds[3],
        policy: 'refuse',
      });
      expect(accepted.problems).toEqual([]);
      expect(accepted.priority_id).toBe(fixture.itilPriorityIds[3]);
    },
  },
  {
    surface: 'REST v1 ticket create and create from asset',
    commitGroup: 'writers-create',
    claims: ['REST v1 create', 'create from asset'],
    probe: async (db, fixture) => {
      const standardId = Object.keys(fixture.itilCategoryIdsByBoard[fixture.boards.itilOne])[0];
      // An API caller holding the first board's standard category id stores the second board's
      // copy of the same standard category (R2), and is refused a category of a third board.
      const translated = await prepareTicketCreateFields(db, fixture.tenantId, {
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.itilPriorityIds[3],
        categoryId: fixture.itilCategoryIdsByBoard[fixture.boards.itilOne][standardId],
        policy: 'refuse',
      });
      expect(translated.problems).toEqual([]);
      expect(translated.category_id).toBe(fixture.itilCategoryIdsByBoard[fixture.boards.itilTwo][standardId]);

      const refused = await prepareTicketCreateFields(db, fixture.tenantId, {
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.itilPriorityIds[3],
        categoryId: fixture.ownCategory.parentId,
        policy: 'refuse',
      });
      expect(refused.problems.map((problem) => problem.field)).toEqual(['category_id']);
    },
  },
  {
    surface: 'CSV import',
    commitGroup: 'writers-create',
    claims: ['CSV import'],
    probe: async (db, fixture) => {
      const standardId = Object.keys(fixture.itilCategoryIdsByBoard[fixture.boards.itilTwo])[0];
      // A row destined for the second ITIL board is checked against that board, not the import's
      // default board, and an unpriced row takes that board's default priority (R7).
      const row = await prepareTicketCreateFields(db, fixture.tenantId, {
        boardId: fixture.boards.itilTwo,
        priorityId: await defaultPriorityForBoard(db, fixture.tenantId, fixture.boards.itilTwo),
        categoryId: fixture.itilCategoryIdsByBoard[fixture.boards.itilTwo][standardId],
        policy: 'refuse',
      });
      expect(row.problems).toEqual([]);
      expect(row.priority_id).toBe(fixture.itilPriorityIds[3]);

      const wrongFamilyRow = await prepareTicketCreateFields(db, fixture.tenantId, {
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.ownPriorityIds[1],
        policy: 'refuse',
      });
      expect(wrongFamilyRow.problems).toHaveLength(1);
    },
  },
  {
    surface: 'Teams message action, guest intake and manual telephony',
    commitGroup: 'writers-create',
    claims: ['Teams message action and guest intake', 'manual telephony ticket'],
    probe: async (db, fixture) => {
      // All three take their priority from R7. A stored default of the other family — easy to
      // leave behind on a board that used to be non-ITIL — no longer reaches the ticket.
      await tenantDb(db, fixture.tenantId)
        .table('boards')
        .where({ board_id: fixture.boards.itilTwo })
        .update({ default_priority_id: fixture.ownPriorityIds[0] });

      const resolved = await defaultPriorityForBoard(db, fixture.tenantId, fixture.boards.itilTwo);
      expect(resolved).toBe(fixture.itilPriorityIds[3]);
      await expect(
        findBoardFieldProblems(db, fixture.tenantId, {
          boardId: fixture.boards.itilTwo,
          priorityId: resolved!,
        })
      ).resolves.toEqual([]);
    },
  },
  {
    surface: 'RMM and Huntress alert tickets',
    commitGroup: 'writers-create',
    claims: ['RMM and Huntress alert tickets'],
    probe: async (db, fixture) => {
      const standardId = Object.keys(fixture.itilCategoryIdsByBoard[fixture.boards.itilOne])[0];
      // Both insert their row directly, so both resolve the fields first: a severity map or rule
      // holding the tenant's own priority falls back to the board default, and a category held for
      // the first ITIL board becomes the second board's copy.
      const fields = await prepareTicketCreateFields(db, fixture.tenantId, {
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.ownPriorityIds[1],
        categoryId: fixture.itilCategoryIdsByBoard[fixture.boards.itilOne][standardId],
        policy: 'fallback',
      });
      expect(fields.problems).toEqual([]);
      expect(fields.priority_id).toBe(fixture.itilPriorityIds[3]);
      expect(fields.category_id).toBe(fixture.itilCategoryIdsByBoard[fixture.boards.itilTwo][standardId]);
    },
  },
  {
    surface: 'Telephony auto-ticket',
    commitGroup: 'writers-create',
    claims: ['Telephony auto-ticket'],
    probe: async (db, fixture) => {
      // Nobody is watching a call become a ticket: the configured priority is replaced, not refused.
      const resolved = await resolveTicketPriorityFields(db, fixture.tenantId, {
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.ownPriorityIds[0],
        policy: 'fallback',
      });
      expect(resolved.problems).toEqual([]);
      expect(resolved.priority_id).toBe(fixture.itilPriorityIds[3]);
    },
  },
  {
    surface: 'Contract renewal ticket',
    commitGroup: 'writers-create',
    claims: ['Contract renewal ticket'],
    probe: async (db, fixture) => {
      // The renewal routing's priority is configuration, so it can predate the board's kind.
      const resolved = await resolveTicketPriorityFields(db, fixture.tenantId, {
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.ownPriorityIds[1],
        policy: 'fallback',
      });
      expect(resolved.priority_id).toBe(fixture.itilPriorityIds[3]);
    },
  },
  {
    surface: 'Workflow `tickets.create`',
    commitGroup: 'writers-create',
    claims: ['Workflow `tickets.create`'],
    probe: async (db, fixture) => {
      const standardId = Object.keys(fixture.itilCategoryIdsByBoard[fixture.boards.itilOne])[1];
      // D7: the action falls back rather than losing the ticket, and a fixed category from the
      // first ITIL board is translated to the second board's copy instead of being dropped.
      const fields = await prepareTicketCreateFields(db, fixture.tenantId, {
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.ownPriorityIds[0],
        categoryId: fixture.itilCategoryIdsByBoard[fixture.boards.itilOne][standardId],
        policy: 'fallback',
      });
      expect(fields.priority_id).toBe(fixture.itilPriorityIds[3]);
      expect(fields.category_id).toBe(fixture.itilCategoryIdsByBoard[fixture.boards.itilTwo][standardId]);
    },
  },
  {
    surface: 'Inbound webhook create',
    commitGroup: 'writers-create',
    claims: ['Inbound webhook create'],
    probe: async (db, fixture) => {
      // D7 again, and the other half of R6's fall-back: a category that belongs to no board of
      // this kind cannot be translated, so it is dropped and the ticket is still created.
      const fields = await prepareTicketCreateFields(db, fixture.tenantId, {
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.ownPriorityIds[0],
        categoryId: fixture.ownCategory.childId,
        policy: 'fallback',
      });
      expect(fields.problems).toEqual([]);
      expect(fields.priority_id).toBe(fixture.itilPriorityIds[3]);
      expect(fields.category_id).toBeNull();
    },
  },
  {
    surface: '`assets.create_maintenance_ticket`',
    commitGroup: 'writers-create',
    claims: ['`assets.create_maintenance_ticket`'],
    probe: async (db, fixture) => {
      const standardId = Object.keys(fixture.itilCategoryIdsByBoard[fixture.boards.itilTwo])[0];
      // A refuse path with a caller who sees the error: the priority family is checked against the
      // selected board, and the board's own standard category is accepted there.
      const refused = await findBoardFieldProblems(db, fixture.tenantId, {
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.ownPriorityIds[0],
      });
      expect(refused.map((problem) => problem.field)).toEqual(['priority_id']);

      await expect(
        findBoardFieldProblems(db, fixture.tenantId, {
          boardId: fixture.boards.itilTwo,
          priorityId: fixture.itilPriorityIds[2],
          categoryId: fixture.itilCategoryIdsByBoard[fixture.boards.itilTwo][standardId],
        })
      ).resolves.toEqual([]);
    },
  },
  {
    surface: 'Data-migration import',
    commitGroup: 'writers-create',
    claims: ['Data-migration import'],
    probe: async (db, fixture) => {
      // The import maps a source priority name to one of the tenant's priorities, which can be of
      // either family; the destination board decides what is actually stored.
      const resolved = await resolveTicketPriorityFields(db, fixture.tenantId, {
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.ownPriorityIds[0],
        policy: 'fallback',
      });
      expect(resolved.priority_id).toBe(fixture.itilPriorityIds[3]);
    },
  },
  {
    surface: 'REST v1 ticket update',
    commitGroup: 'writers-update',
    claims: ['update'],
    probe: async (db, fixture) => {
      const standardIds = Object.keys(fixture.itilCategoryIdsByBoard[fixture.boards.itilTwo]);
      const ticketId = await insertProbeTicket(db, fixture, fixture.boards.itilTwo);
      const current = { board_id: fixture.boards.itilTwo, priority_id: fixture.itilPriorityIds[3] };

      // The subcategory check the REST update used to lack, on the second ITIL board.
      const mismatched: Record<string, unknown> = {
        category_id: fixture.itilCategoryIdsByBoard[fixture.boards.itilTwo][standardIds[0]],
        subcategory_id: fixture.itilCategoryIdsByBoard[fixture.boards.itilTwo][standardIds[1]],
      };
      const problems = await prepareTicketFieldPatch(db, fixture.tenantId, current, mismatched);
      expect(problems.map((problem) => problem.field)).toContain('subcategory_id');

      // And the board's own standard category is accepted there.
      const accepted: Record<string, unknown> = {
        category_id: fixture.itilCategoryIdsByBoard[fixture.boards.itilTwo][standardIds[0]],
      };
      expect(await prepareTicketFieldPatch(db, fixture.tenantId, current, accepted)).toEqual([]);
      expect(ticketId).toBeTruthy();
    },
  },
  {
    surface: 'Workflow `tickets.update_fields`',
    commitGroup: 'writers-update',
    claims: ['Workflow `tickets.update_fields`'],
    probe: async (db, fixture) => {
      const standardId = Object.keys(fixture.itilCategoryIdsByBoard[fixture.boards.itilOne])[0];
      // The action holds one board's category id. On a ticket of the second ITIL board that id is
      // translated to the board's own copy instead of being refused (R2).
      const patch: Record<string, unknown> = {
        category_id: fixture.itilCategoryIdsByBoard[fixture.boards.itilOne][standardId],
      };
      const problems = await prepareTicketFieldPatch(
        db,
        fixture.tenantId,
        { board_id: fixture.boards.itilTwo, priority_id: fixture.itilPriorityIds[3] },
        patch
      );
      expect(problems).toEqual([]);
      expect(patch.category_id).toBe(fixture.itilCategoryIdsByBoard[fixture.boards.itilTwo][standardId]);
    },
  },
  {
    surface: 'Inbound webhook update',
    commitGroup: 'writers-update',
    claims: ['Inbound webhook update'],
    probe: async (db, fixture) => {
      // A webhook update that names a priority of the tenant's own family for a ticket on the
      // second ITIL board is refused: the caller sees the error (R6).
      const problems = await prepareTicketFieldPatch(
        db,
        fixture.tenantId,
        { board_id: fixture.boards.itilTwo, priority_id: fixture.itilPriorityIds[3] },
        { priority_id: fixture.ownPriorityIds[0] }
      );
      expect(problems.map((problem) => problem.field)).toEqual(['priority_id']);
      expect(problems[0].message).toContain('ITIL Two');
    },
  },
  {
    surface: 'Activities inline priority picker',
    commitGroup: 'writers-update',
    claims: ['Activities inline priority', 'Activities inline picker'],
    probe: async (db, fixture) => {
      const ticketId = await insertProbeTicket(db, fixture, fixture.boards.itilTwo);
      const { updateActivityPriorityById } = await import(
        '../../../../packages/user-activities/src/actions/activityStatusActions'
      );
      const { ActivityType } = await import('../../../../packages/types/src/interfaces/activity.interfaces');

      // The write is checked against the ticket's board, so the grid cannot store a priority the
      // board does not use — and a fitting one still saves.
      await expect(
        updateActivityPriorityById(ticketId, ActivityType.TICKET, fixture.ownPriorityIds[0])
      ).rejects.toThrow(/ITIL Two/);
      await updateActivityPriorityById(ticketId, ActivityType.TICKET, fixture.itilPriorityIds[1]);
      const stored = await tenantDb(db, fixture.tenantId)
        .table('tickets')
        .where({ ticket_id: ticketId })
        .first('priority_id');
      expect(stored.priority_id).toBe(fixture.itilPriorityIds[1]);
    },
  },
  {
    surface: 'Bundle sync',
    commitGroup: 'writers-update',
    claims: ['Bundle sync'],
    probe: async (db, fixture) => {
      // Sync mirrors the master's priority only onto children whose board uses the same family. A
      // child on the second ITIL board takes an ITIL priority; one on the tenant's own board keeps
      // its own.
      await expect(
        findBoardFieldProblems(db, fixture.tenantId, {
          boardId: fixture.boards.itilTwo,
          priorityId: fixture.itilPriorityIds[1],
        })
      ).resolves.toEqual([]);
      const refused = await findBoardFieldProblems(db, fixture.tenantId, {
        boardId: fixture.boards.own,
        priorityId: fixture.itilPriorityIds[1],
      });
      expect(refused.map((problem) => problem.field)).toEqual(['priority_id']);
    },
  },
  {
    surface: 'Create ticket from asset (MSP)',
    commitGroup: 'priority-pickers',
    claims: ['Create ticket from asset'],
    probe: async (db, fixture) => {
      // The dialog filters the list it fetched by the selected board's kind, so every value it
      // offers on the second ITIL board passes the server's own check.
      const { filterPrioritiesForBoard } = await import(
        '../../../../packages/tickets/src/lib/boardDefaultPriority'
      );
      const all = await tenantDb(db, fixture.tenantId)
        .table('priorities')
        .where({ item_type: 'ticket' })
        .select('priority_id', 'is_from_itil_standard');
      const offered = filterPrioritiesForBoard(all as any[], 'itil');
      expect(offered.map((priority: any) => priority.priority_id).sort()).toEqual(
        Object.values(fixture.itilPriorityIds).sort()
      );
      for (const priority of offered) {
        await expect(
          findBoardFieldProblems(db, fixture.tenantId, {
            boardId: fixture.boards.itilTwo,
            priorityId: (priority as any).priority_id,
          })
        ).resolves.toEqual([]);
      }
    },
  },
  {
    surface: 'Workflow designer (two copies)',
    commitGroup: 'priority-pickers',
    claims: ['Workflow designer (two copies)'],
    probe: async (db, fixture) => {
      // Both copies narrow the priority list by the action's fixed board, using the family the
      // options payload now carries. The payload is what this probe checks on the second board.
      const { getTicketFieldOptions } = await import(
        '../../../../packages/integrations/src/actions/email-actions/ticketFieldOptionsActions'
      );
      const result = (await getTicketFieldOptions()) as any;
      const options = result.options;
      const boardTwo = options.boards.find((board: any) => board.id === fixture.boards.itilTwo);
      expect(boardTwo.priority_type).toBe('itil');
      const itilOptions = options.priorities.filter((priority: any) => priority.is_from_itil_standard);
      expect(itilOptions.map((priority: any) => priority.id).sort()).toEqual(
        Object.values(fixture.itilPriorityIds).sort()
      );
    },
  },
  {
    surface: 'Huntress settings',
    commitGroup: 'priority-pickers',
    claims: ['Huntress settings'],
    probe: async (db, fixture) => {
      // The severity map is offered the selected board's priorities; the rows carry the family and
      // the board carries its kind, which is what the screen filters on.
      const boards = await tenantDb(db, fixture.tenantId)
        .table('boards')
        .select('board_id', 'priority_type');
      expect(boards.find((board: any) => board.board_id === fixture.boards.itilTwo)?.priority_type).toBe('itil');
      const offered = await listPrioritiesForBoard(db, fixture.tenantId, fixture.boards.itilTwo, 'ticket');
      expect(offered.map((priority) => priority.priority_id).sort()).toEqual(
        Object.values(fixture.itilPriorityIds).sort()
      );
    },
  },
  {
    surface: 'Inbound webhook mapping',
    commitGroup: 'priority-pickers',
    claims: ['Inbound webhook mapping'],
    probe: async (db, fixture) => {
      const { listInboundWebhookLookup } = await import('../../lib/actions/inboundWebhookLookups');
      const offered = await listInboundWebhookLookup({
        entityType: 'ticket_priority',
        scope: { board_id: fixture.boards.itilTwo },
      });
      expect(offered.map((option: any) => option.value).sort()).toEqual(
        Object.values(fixture.itilPriorityIds).sort()
      );
    },
  },
  {
    surface: 'RMM alert rules',
    commitGroup: 'priority-pickers',
    claims: ['RMM alert rules'],
    probe: async (db, fixture) => {
      const { getRmmAlertRuleFormOptions } = await import(
        '../../../../packages/integrations/src/actions/integrations/rmmAlertRuleActions'
      );
      const result = (await getRmmAlertRuleFormOptions({ integrationId: fixture.tenantId })) as any;
      const offered = (result?.data ?? result).priorities;
      const projectTaskIds = await tenantDb(db, fixture.tenantId)
        .table('priorities')
        .where({ item_type: 'project_task' })
        .pluck('priority_id');
      expect(offered.some((priority: any) => projectTaskIds.includes(priority.priority_id))).toBe(false);
    },
  },
  {
    surface: 'REST priorities',
    commitGroup: 'priority-pickers',
    claims: ['REST priorities'],
    probe: async (db, fixture) => {
      // The engine behind `GET /api/v1/tickets/priorities?board_id=`: one family, with the level.
      const offered = await listPrioritiesForBoard(db, fixture.tenantId, fixture.boards.itilTwo, 'ticket');
      expect(offered.map((priority) => priority.priority_id).sort()).toEqual(
        Object.values(fixture.itilPriorityIds).sort()
      );
      expect(offered.every((priority) => typeof priority.itil_priority_level === 'number')).toBe(true);
    },
  },
  {
    surface: 'Mobile ticket detail',
    commitGroup: 'priority-pickers',
    claims: ['Mobile ticket detail'],
    probe: async (db, fixture) => {
      // Mobile asks the REST endpoint for the ticket's board, so a ticket with no priority yet on
      // the second ITIL board is still offered only ITIL priorities.
      const offered = await listPrioritiesForBoard(db, fixture.tenantId, fixture.boards.itilTwo, 'ticket');
      expect(offered.map((priority) => priority.priority_id).sort()).toEqual(
        Object.values(fixture.itilPriorityIds).sort()
      );
    },
  },
  {
    surface: 'Board create, update and delete',
    commitGroup: 'board-lifecycle',
    claims: [],
    expectedFail:
      'the REST board API writes a raw row with no statuses, ITIL rows or default priority, and its delete skips every web check',
  },
  {
    surface: 'Board type switch',
    commitGroup: 'board-type-switch',
    claims: [],
    expectedFail: 'a board’s kind cannot be changed from the UI at all',
  },
  {
    surface: 'ITIL SLA policy for a new board',
    commitGroup: 'sla',
    claims: [],
    expectedFail: 'the hook is a module variable registered from an MSP layout, so a server action may never see it',
  },
];

/** Tokens the plan documents name, which every row together has to claim (T044). */
function planSurfaceTokens(): string[] {
  const prd = fs.readFileSync(path.resolve(PLAN_DIR, 'PRD.md'), 'utf8');
  const scratchpad = fs.readFileSync(path.resolve(PLAN_DIR, 'SCRATCHPAD.md'), 'utf8');
  const tokens = new Set<string>();

  const tableAfter = (text: string, header: string): string[] => {
    const start = text.indexOf(header);
    expect(start, `plan table not found: ${header}`).toBeGreaterThan(-1);
    const block = text.slice(start).split('\n\n')[0].split('\n');
    return block.slice(2).filter((line) => line.startsWith('|'));
  };

  // The R6 refuse/fall-back table: one or more writers per cell.
  for (const row of tableAfter(prd, '| Refuse with a field error | Fall back |')) {
    for (const cell of row.trim().replace(/^\||\|$/g, '').split('|')) {
      for (const token of cell.replace(/\([^)]*\)/g, '').split(',')) {
        const trimmed = token.trim();
        if (trimmed) tokens.add(trimmed);
      }
    }
  }

  // The traced-pickers table: the surface is the first cell.
  for (const row of tableAfter(scratchpad, '| Surface | Where | Categories | Priorities |')) {
    const surface = row.split('|')[1].trim();
    if (surface) tokens.add(surface);
  }

  return [...tokens].sort();
}

function unimplementedGroups(): Set<string> {
  const features = JSON.parse(fs.readFileSync(path.resolve(PLAN_DIR, 'features.json'), 'utf8'));
  return new Set(
    features.filter((feature: any) => !feature.implemented).map((feature: any) => feature.commitGroup)
  );
}

const covered = SURFACES.filter((surface) => surface.probe);
const pending = SURFACES.filter((surface) => !surface.probe);

/**
 * The table-versus-plan checks need no database: they are the contract that keeps the table in
 * step with the plan documents, and they have to run in every lane.
 */
describe('ITIL second-board surface table', () => {
it('T044: every surface the plan names is claimed by exactly one row', () => {
  const claimedBy = new Map<string, string[]>();
  for (const surface of SURFACES) {
    for (const claim of surface.claims) {
      claimedBy.set(claim, [...(claimedBy.get(claim) ?? []), surface.surface]);
    }
  }

  const tokens = planSurfaceTokens();
  expect(tokens.length).toBeGreaterThan(20);

  const unclaimed = tokens.filter((token) => !claimedBy.has(token));
  expect(unclaimed, `plan surfaces with no row in the table: ${unclaimed.join(', ')}`).toEqual([]);

  const claimedTwice = [...claimedBy.entries()].filter(([, rows]) => rows.length > 1);
  expect(claimedTwice.map(([token]) => token), 'surfaces claimed by more than one row').toEqual([]);

  const unknown = [...claimedBy.keys()].filter((claim) => !tokens.includes(claim));
  expect(unknown, `rows claiming a surface the plan does not name: ${unknown.join(', ')}`).toEqual([]);
});

it('T044: a row is expected-fail exactly while its commit group is unimplemented', () => {
  const unimplemented = unimplementedGroups();
  const wrongly = pending.filter((surface) => !unimplemented.has(surface.commitGroup));
  expect(
    wrongly.map((surface) => `${surface.surface} (${surface.commitGroup})`),
    'these groups are implemented but their surface rows are still expected-fail'
  ).toEqual([]);

  const prematurely = covered.filter((surface) => unimplemented.has(surface.commitGroup));
  expect(
    prematurely.map((surface) => `${surface.surface} (${surface.commitGroup})`),
    'these rows claim coverage from a group that has not landed'
  ).toEqual([]);
});
});

describe('ITIL second-board surfaces (integration)', () => {
  let db: Knex;
  let fixture: ItilSecondBoardFixture;

  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection({ runSeeds: false });
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    if (fixture) {
      await cleanupItilSecondBoardFixture(db, fixture.tenantId);
      fixture = undefined as unknown as ItilSecondBoardFixture;
    }
  });

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('T043: the fixture builds two ITIL boards, a non-ITIL board and a legacy mixed board', async () => {
    fixture = await createItilSecondBoardFixture(db);
    const tt = (table: string) => tenantDb(db, fixture.tenantId).table(table);

    const boards = await tt('boards').select('board_id', 'board_name', 'category_type', 'priority_type');
    const byName = Object.fromEntries(boards.map((board: any) => [board.board_name, board]));
    expect(Object.keys(byName).sort()).toEqual(['ITIL One', 'ITIL Two', 'Legacy Mixed', 'Own Work']);
    expect(byName['ITIL One']).toMatchObject({ category_type: 'itil', priority_type: 'itil' });
    expect(byName['ITIL Two']).toMatchObject({ category_type: 'itil', priority_type: 'itil' });
    expect(byName['Own Work']).toMatchObject({ category_type: 'custom', priority_type: 'custom' });
    expect(byName['Legacy Mixed']).toMatchObject({ category_type: 'custom', priority_type: 'itil' });

    // Both priority families, tenant-wide, plus a project-task row no ticket picker may offer.
    const priorities = await tt('priorities').select('priority_id', 'item_type', 'is_from_itil_standard', 'itil_priority_level');
    const itil = priorities.filter((row: any) => row.is_from_itil_standard && row.item_type === 'ticket');
    const own = priorities.filter((row: any) => !row.is_from_itil_standard && row.item_type === 'ticket');
    expect(itil.map((row: any) => Number(row.itil_priority_level)).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(own).toHaveLength(2);
    expect(priorities.some((row: any) => row.item_type === 'project_task')).toBe(true);

    // The tenant's own categories belong to the non-ITIL board.
    const ownCategories = await tt('categories').where({ board_id: fixture.boards.own }).select('category_id', 'parent_category');
    expect(ownCategories).toHaveLength(2);
    expect(ownCategories.filter((row: any) => row.parent_category)).toHaveLength(1);

    // The ITIL standard set, in the shape the fixture declares.
    const standardCount = Number(
      (await db('standard_categories').where({ is_itil_standard: true }).count('* as n').first() as any).n
    );
    const flagged = await tt('categories').where({ is_from_itil_standard: true }).select('category_id', 'board_id');
    const boardsHoldingTheSet = new Set(flagged.map((row: any) => row.board_id));
    if (expectedItilCategoryOwnership === 'single-set-on-first-itil-board') {
      expect(flagged).toHaveLength(standardCount);
      expect([...boardsHoldingTheSet]).toEqual([fixture.boards.itilOne]);
    } else {
      expect(flagged).toHaveLength(standardCount * 2);
      expect([...boardsHoldingTheSet].sort()).toEqual([fixture.boards.itilOne, fixture.boards.itilTwo].sort());
      // Each board's copies are distinct rows linked to the same standard rows.
      for (const boardId of [fixture.boards.itilOne, fixture.boards.itilTwo]) {
        const links = await tt('categories').where({ board_id: boardId }).whereNotNull('standard_category_id').pluck('standard_category_id');
        expect(new Set(links).size).toBe(standardCount);
      }
      // The non-standard category of ITIL Two stays attached to it (R2).
      const extra = await tt('categories').where({ category_id: fixture.itilTwoOwnCategoryId }).first('board_id', 'standard_category_id');
      expect(extra.board_id).toBe(fixture.boards.itilTwo);
      expect(extra.standard_category_id).toBeNull();
    }
  }, HOOK_TIMEOUT);

  describe('covered surfaces behave on the second ITIL board', () => {
    it.each(covered.map((surface) => [surface.surface, surface] as const))(
      '%s',
      async (_name, surface) => {
        fixture = await createItilSecondBoardFixture(db);
        dbRef.knex = db;
        dbRef.tenant = fixture.tenantId;
        userRef.user = { user_id: fixture.userId, user_type: 'internal', tenant: fixture.tenantId };
        await surface.probe!(db, fixture);
      },
      HOOK_TIMEOUT
    );
  });

  describe('surfaces still waiting for their commit group', () => {
    for (const surface of pending) {
      it.todo(`${surface.surface} — ${surface.commitGroup}: ${surface.expectedFail}`);
    }
  });
});
