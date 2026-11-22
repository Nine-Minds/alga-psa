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

import { tenantDb } from '@alga-psa/db';
import {
  defaultPriorityForBoard,
  findBoardFieldProblems,
  listPrioritiesForBoard,
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
    expectedFail: 'the co-managed option search offers every ticket priority, of both families',
  },
  {
    surface: 'Checklist apply rules',
    commitGroup: 'category-filters',
    claims: ['Checklist apply rules'],
    expectedFail:
      'a rule naming a standard category with no board matches only the board holding the original row',
  },
  {
    surface: 'All-boards and client portal category filters',
    commitGroup: 'category-filters',
    claims: [],
    expectedFail: 'one entry per board’s copy of a standard category, and no standard-aware matching',
  },
  {
    surface: 'Saved list views',
    commitGroup: 'category-filters',
    claims: [],
    expectedFail: 'the view loader drops a category id it does not know for the board instead of translating it',
  },
  {
    surface: 'Impact × Urgency on MSP create and update',
    commitGroup: 'impact-urgency',
    claims: ['MSP create and update'],
    expectedFail:
      'the ITIL priority is looked up by `priority_name LIKE ‘P{n} -%’` and is computed whenever Impact and Urgency are present, whatever the board',
  },
  {
    surface: 'Service request provider',
    commitGroup: 'impact-urgency',
    claims: ['Service request provider'],
    expectedFail: 'ticketOnlyExecutionProvider looks the ITIL priority up by name',
  },
  {
    surface: 'Service request editor',
    commitGroup: 'priority-pickers',
    claims: ['Service request editor'],
    expectedFail: 'a board with the tenant’s own priorities is offered every ticket priority',
  },
  {
    surface: 'Client portal create',
    commitGroup: 'writers-create',
    claims: ['Client portal create'],
    expectedFail: 'no priority or category check runs on the client portal create path',
  },
  {
    surface: 'REST v1 ticket create and create from asset',
    commitGroup: 'writers-create',
    claims: ['REST v1 create', 'create from asset'],
    expectedFail: 'the REST create paths check the priority family but not the category’s board',
  },
  {
    surface: 'CSV import',
    commitGroup: 'writers-create',
    claims: ['CSV import'],
    expectedFail:
      'priorities are matched by name across families and ITIL-ness is taken from the default board, not the row’s board',
  },
  {
    surface: 'Teams message action, guest intake and manual telephony',
    commitGroup: 'writers-create',
    claims: ['Teams message action and guest intake', 'manual telephony ticket'],
    expectedFail: 'each resolves a default priority of its own, none of them by the board’s kind',
  },
  {
    surface: 'RMM and Huntress alert tickets',
    commitGroup: 'writers-create',
    claims: ['RMM and Huntress alert tickets'],
    expectedFail: 'both insert their ticket rows directly, with no board field check',
  },
  {
    surface: 'Telephony auto-ticket',
    commitGroup: 'writers-create',
    claims: ['Telephony auto-ticket'],
    expectedFail: 'autoTicketFromCall writes the configured priority whatever the board',
  },
  {
    surface: 'Contract renewal ticket',
    commitGroup: 'writers-create',
    claims: ['Contract renewal ticket'],
    expectedFail: 'renewalTicket writes the configured priority whatever the board',
  },
  {
    surface: 'Workflow `tickets.create`',
    commitGroup: 'writers-create',
    claims: ['Workflow `tickets.create`'],
    expectedFail: 'no board field check, and a fixed category from another ITIL board is not translated',
  },
  {
    surface: 'Inbound webhook create',
    commitGroup: 'writers-create',
    claims: ['Inbound webhook create'],
    expectedFail: 'no board field check on the webhook create path',
  },
  {
    surface: '`assets.create_maintenance_ticket`',
    commitGroup: 'writers-create',
    claims: ['`assets.create_maintenance_ticket`'],
    expectedFail: 'the maintenance workflow action writes its priority and category unchecked',
  },
  {
    surface: 'Data-migration import',
    commitGroup: 'writers-create',
    claims: ['Data-migration import'],
    expectedFail: 'entityAppliers inserts tickets with no board field check',
  },
  {
    surface: 'REST v1 ticket update',
    commitGroup: 'writers-update',
    claims: ['update'],
    expectedFail: 'TicketService.updateTicket checks the priority family but not the subcategory',
  },
  {
    surface: 'Workflow `tickets.update_fields`',
    commitGroup: 'writers-update',
    claims: ['Workflow `tickets.update_fields`'],
    expectedFail: 'TicketModel.updateTicket applies no board field rule',
  },
  {
    surface: 'Inbound webhook update',
    commitGroup: 'writers-update',
    claims: ['Inbound webhook update'],
    expectedFail: 'the webhook update path applies no board field rule',
  },
  {
    surface: 'Activities inline priority picker',
    commitGroup: 'writers-update',
    claims: ['Activities inline priority', 'Activities inline picker'],
    expectedFail: 'InlinePriorityPicker offers every priority and the write is unchecked',
  },
  {
    surface: 'Bundle sync',
    commitGroup: 'writers-update',
    claims: ['Bundle sync'],
    expectedFail: 'the mirrored child takes the parent’s priority whatever its own board uses',
  },
  {
    surface: 'Create ticket from asset (MSP)',
    commitGroup: 'priority-pickers',
    claims: ['Create ticket from asset'],
    expectedFail: 'CreateTicketFromAssetButton offers every priority',
  },
  {
    surface: 'Workflow designer (two copies)',
    commitGroup: 'priority-pickers',
    claims: ['Workflow designer (two copies)'],
    expectedFail: 'neither copy is sent the priority family, and categories are filtered by boardId alone',
  },
  {
    surface: 'Huntress settings',
    commitGroup: 'priority-pickers',
    claims: ['Huntress settings'],
    expectedFail: 'offers every priority and filters categories by board_id alone',
  },
  {
    surface: 'Inbound webhook mapping',
    commitGroup: 'priority-pickers',
    claims: ['Inbound webhook mapping'],
    expectedFail: 'inboundWebhookLookups filters neither by item_type nor by board',
  },
  {
    surface: 'RMM alert rules',
    commitGroup: 'priority-pickers',
    claims: ['RMM alert rules'],
    expectedFail: 'rmmAlertRuleActions does not filter by item_type',
  },
  {
    surface: 'REST priorities',
    commitGroup: 'priority-pickers',
    claims: ['REST priorities'],
    expectedFail: '`GET /api/v1/tickets/priorities` takes no board_id and omits the ITIL level',
  },
  {
    surface: 'Mobile ticket detail',
    commitGroup: 'priority-pickers',
    claims: ['Mobile ticket detail'],
    expectedFail: 'useTicketPriority guesses the family from the ticket’s current priority',
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
