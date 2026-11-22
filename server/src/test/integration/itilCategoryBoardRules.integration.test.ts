/**
 * T075–T106 — F038–F056 of `ee/plans/2026-11-21-itil-remediation` (`category-rules`).
 *
 * A category belongs to a board, ITIL or not (R2/D9): the listers, the shared check, per-board
 * seeding, board delete, the locks on a standard row, the write whitelist, the permission gates,
 * CSV import matching and the translation between two boards' copies of the same standard row.
 *
 * Each test builds its own tenant, as `itilBoardFieldRules.integration.test.ts` does.
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

const permissionRef = vi.hoisted(() => ({
  allow: true as boolean,
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth')>()),
  withAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  withOptionalAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: vi.fn(async () => permissionRef.allow),
  preCheckDeletion: vi.fn(async () => ({ allowed: true })),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => permissionRef.allow),
}));

import {
  findBoardFieldProblems,
  listCategoriesForBoard,
  translateStandardCategoryForBoard,
} from '@alga-psa/shared/lib/tickets/boardFieldRules';
import { ItilStandardsService } from '../../../../packages/tickets/src/services/itilStandardsService';
import {
  copyTicketCategoriesToBoard,
  createCategory,
  deleteCategory,
  getAllCategories,
  getTicketCategoriesByBoard,
  updateCategory,
  updateTicketCategory,
} from '../../../../packages/tickets/src/actions/ticketCategoryActions';
import { deleteReferenceDataItem } from '../../../../packages/reference-data/src/actions/referenceDataActions';
import { findTicketFieldReferenceProblems } from '../../../../packages/tickets/src/lib/ticketFieldReferences';

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
  await tt(tenantId, 'contacts').del();
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
  categoryType?: 'custom' | 'itil';
  priorityType?: 'custom' | 'itil';
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
    user_type: 'internal',
  });

  const boardIds: Record<string, string> = {};
  await tt(tenantId, 'boards').insert(
    boards.map((board, index) => {
      const boardId = uuidv4();
      boardIds[board.name] = boardId;
      return {
        tenant: tenantId,
        board_id: boardId,
        board_name: board.name,
        display_order: (index + 1) * 10,
        is_default: index === 0,
        is_inactive: false,
        category_type: board.categoryType ?? 'custom',
        priority_type: board.priorityType ?? 'custom',
      };
    })
  );

  dbRef.knex = db;
  dbRef.tenant = tenantId;
  permissionRef.allow = true;
  userRef.user = { user_id: userId, user_type: 'internal', tenant: tenantId };

  return { tenantId, userId, boards: boardIds };
}

async function insertCategory(
  fixture: Fixture,
  name: string,
  boardId: string | null,
  options: { parent?: string | null; standardCategoryId?: string | null; displayOrder?: number } = {}
): Promise<string> {
  const categoryId = uuidv4();
  await tt(fixture.tenantId, 'categories').insert({
    tenant: fixture.tenantId,
    category_id: categoryId,
    category_name: name,
    board_id: boardId,
    parent_category: options.parent ?? null,
    standard_category_id: options.standardCategoryId ?? null,
    is_from_itil_standard: Boolean(options.standardCategoryId),
    display_order: options.displayOrder ?? 0,
    created_by: fixture.userId,
  });
  return categoryId;
}

async function seedItilCategories(fixture: Fixture, boardId: string): Promise<void> {
  await db.transaction(async (trx) => {
    await ItilStandardsService.copyItilCategoriesToTenant(trx, fixture.tenantId, fixture.userId, boardId);
  });
}

async function standardCategoryCount(): Promise<number> {
  const row = (await db('standard_categories').where({ is_itil_standard: true }).count('* as n').first()) as any;
  return Number(row.n);
}

async function standardTopLevel(): Promise<{ id: string; category_name: string }> {
  return db('standard_categories')
    .where({ is_itil_standard: true })
    .whereNull('parent_category_uuid')
    .orderBy('display_order', 'asc')
    .first('id', 'category_name');
}

async function insertStatus(fixture: Fixture, boardId: string): Promise<string> {
  const statusId = uuidv4();
  await tt(fixture.tenantId, 'statuses').insert({
    tenant: fixture.tenantId,
    status_id: statusId,
    name: 'New',
    board_id: boardId,
    status_type: 'ticket',
    is_closed: false,
    is_default: true,
    order_number: 1,
    created_by: fixture.userId,
  });
  return statusId;
}

async function insertItilPriority(fixture: Fixture, level: number): Promise<string> {
  const priorityId = uuidv4();
  await tt(fixture.tenantId, 'priorities').insert({
    tenant: fixture.tenantId,
    priority_id: priorityId,
    priority_name: `P${level} - ITIL`,
    color: '#DC2626',
    order_number: 99 + level,
    item_type: 'ticket',
    is_from_itil_standard: true,
    itil_priority_level: level,
    created_by: fixture.userId,
  });
  return priorityId;
}

async function insertClient(fixture: Fixture): Promise<string> {
  const clientId = uuidv4();
  await tt(fixture.tenantId, 'clients').insert({
    tenant: fixture.tenantId,
    client_id: clientId,
    client_name: 'Fixture client',
  });
  return clientId;
}

async function insertTicket(
  fixture: Fixture,
  values: { boardId: string; statusId: string; priorityId: string; clientId: string; categoryId?: string | null; subcategoryId?: string | null }
): Promise<string> {
  const ticketId = uuidv4();
  await tt(fixture.tenantId, 'tickets').insert({
    tenant: fixture.tenantId,
    ticket_id: ticketId,
    ticket_number: `T-${ticketId.slice(0, 8)}`,
    title: 'Fixture ticket',
    board_id: values.boardId,
    status_id: values.statusId,
    priority_id: values.priorityId,
    client_id: values.clientId,
    category_id: values.categoryId ?? null,
    subcategory_id: values.subcategoryId ?? null,
    entered_by: fixture.userId,
    entered_at: new Date().toISOString(),
  });
  return ticketId;
}

/**
 * `BaseService.getKnex` resolves its connection inside `@alga-psa/db`, past this file's module
 * mock, so the REST service gets the suite's connection through a subclass instead.
 */
async function categoryService(fixture: Fixture) {
  const { CategoryService } = await import('../../lib/api/services/CategoryService');
  class SuiteCategoryService extends CategoryService {
    protected async getKnex(): Promise<{ knex: Knex; tenant: string }> {
      return { knex: db, tenant: fixture.tenantId };
    }
  }
  return new SuiteCategoryService();
}

describe('ITIL categories belong to a board (integration)', () => {
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

  describe('listCategoriesForBoard (F038)', () => {
    it('T075: two ITIL boards offer the same standard names through different rows', async () => {
      const fixture = await createFixture([
        { name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' },
        { name: 'ITIL Two', categoryType: 'itil', priorityType: 'itil' },
      ]);
      await seedItilCategories(fixture, fixture.boards['ITIL One']);
      await seedItilCategories(fixture, fixture.boards['ITIL Two']);

      const onOne = await listCategoriesForBoard(db, fixture.tenantId, fixture.boards['ITIL One']);
      const onTwo = await listCategoriesForBoard(db, fixture.tenantId, fixture.boards['ITIL Two']);

      const expected = await standardCategoryCount();
      expect(onOne).toHaveLength(expected);
      expect(onTwo).toHaveLength(expected);
      expect(onTwo.map((category) => category.category_name).sort()).toEqual(
        onOne.map((category) => category.category_name).sort()
      );
      const sharedIds = onTwo.filter((category) =>
        onOne.some((other) => other.category_id === category.category_id)
      );
      expect(sharedIds).toEqual([]);
      expect(onTwo.every((category) => category.standard_category_id)).toBe(true);
    });

    it('T076: a non-ITIL board returns only its own categories', async () => {
      const fixture = await createFixture([
        { name: 'Own Work' },
        { name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' },
      ]);
      await seedItilCategories(fixture, fixture.boards['ITIL One']);
      const ownId = await insertCategory(fixture, 'Workstations', fixture.boards['Own Work']);

      const list = await listCategoriesForBoard(db, fixture.tenantId, fixture.boards['Own Work']);
      expect(list.map((category) => category.category_id)).toEqual([ownId]);
    });

    it('T077: an ITIL board also returns a non-standard category attached to it', async () => {
      const fixture = await createFixture([{ name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' }]);
      await seedItilCategories(fixture, fixture.boards['ITIL One']);
      const extraId = await insertCategory(fixture, 'Board-only extra', fixture.boards['ITIL One'], {
        displayOrder: 900,
      });

      const list = await listCategoriesForBoard(db, fixture.tenantId, fixture.boards['ITIL One']);
      expect(list).toHaveLength((await standardCategoryCount()) + 1);
      expect(list.map((category) => category.category_id)).toContain(extraId);
    });
  });

  describe('every lister goes through the same rule (F039)', () => {
    it('T078: the action, the ticket-form hydration and the REST list return the same rows for a board', async () => {
      const fixture = await createFixture([
        { name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' },
        { name: 'ITIL Two', categoryType: 'itil', priorityType: 'itil' },
      ]);
      await seedItilCategories(fixture, fixture.boards['ITIL One']);
      await seedItilCategories(fixture, fixture.boards['ITIL Two']);

      const action = (await getTicketCategoriesByBoard(fixture.boards['ITIL Two'])) as any;
      const shared = await listCategoriesForBoard(db, fixture.tenantId, fixture.boards['ITIL Two']);
      // The hydration and the REST route both call the shared lister, so comparing the action with
      // it is comparing the three.
      expect(action.categories.map((category: any) => category.category_id)).toEqual(
        shared.map((category) => category.category_id)
      );
      expect(action.boardConfig.category_type).toBe('itil');
    });
  });

  describe('the shared check reports a category that is not the board’s (F040)', () => {
    it('T079: a category from another board is reported, on an ITIL and on a non-ITIL board', async () => {
      const fixture = await createFixture([
        { name: 'Own Work' },
        { name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' },
        { name: 'ITIL Two', categoryType: 'itil', priorityType: 'itil' },
      ]);
      await seedItilCategories(fixture, fixture.boards['ITIL One']);
      await seedItilCategories(fixture, fixture.boards['ITIL Two']);
      const ownId = await insertCategory(fixture, 'Workstations', fixture.boards['Own Work']);
      const onOne = (await listCategoriesForBoard(db, fixture.tenantId, fixture.boards['ITIL One']))
        .find((category) => !category.parent_category)!;

      const onItil = await findBoardFieldProblems(db, fixture.tenantId, {
        boardId: fixture.boards['ITIL Two'],
        categoryId: onOne.category_id,
      });
      expect(onItil.map((problem) => problem.field)).toEqual(['category_id']);
      expect(onItil[0].message).toContain('ITIL Two');

      const onOwn = await findBoardFieldProblems(db, fixture.tenantId, {
        boardId: fixture.boards['ITIL Two'],
        categoryId: ownId,
      });
      expect(onOwn.map((problem) => problem.field)).toEqual(['category_id']);

      const reverse = await findBoardFieldProblems(db, fixture.tenantId, {
        boardId: fixture.boards['Own Work'],
        categoryId: onOne.category_id,
      });
      expect(reverse.map((problem) => problem.field)).toEqual(['category_id']);
    });

    it('T080: a subcategory whose parent is not the ticket’s category is reported', async () => {
      const fixture = await createFixture([{ name: 'Own Work' }]);
      const parentA = await insertCategory(fixture, 'Parent A', fixture.boards['Own Work']);
      const parentB = await insertCategory(fixture, 'Parent B', fixture.boards['Own Work']);
      const childOfB = await insertCategory(fixture, 'Child of B', fixture.boards['Own Work'], { parent: parentB });

      const problems = await findBoardFieldProblems(db, fixture.tenantId, {
        boardId: fixture.boards['Own Work'],
        categoryId: parentA,
        subcategoryId: childOfB,
      });
      expect(problems.map((problem) => problem.field)).toEqual(['subcategory_id']);
      expect(problems[0].message).toContain('Child of B');
    });
  });

  describe('the copies of the check are gone (F041)', () => {
    it('T081: a template and a schedule on the second ITIL board accept a standard category', async () => {
      const fixture = await createFixture([
        { name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' },
        { name: 'ITIL Two', categoryType: 'itil', priorityType: 'itil' },
      ]);
      await seedItilCategories(fixture, fixture.boards['ITIL One']);
      await seedItilCategories(fixture, fixture.boards['ITIL Two']);
      const statusId = await insertStatus(fixture, fixture.boards['ITIL Two']);
      const priorityId = await insertItilPriority(fixture, 3);
      const onTwo = await listCategoriesForBoard(db, fixture.tenantId, fixture.boards['ITIL Two']);
      const parent = onTwo.find((category) => !category.parent_category)!;
      const child = onTwo.find((category) => category.parent_category === parent.category_id);

      // The template/schedule validator is the one every generated occurrence runs.
      await expect(
        findTicketFieldReferenceProblems(db, fixture.tenantId, {
          fields: {
            board_id: fixture.boards['ITIL Two'],
            status_id: statusId,
            priority_id: priorityId,
            category_id: parent.category_id,
            subcategory_id: child?.category_id ?? null,
          },
          schedule: true,
        })
      ).resolves.toEqual([]);

      // The first board's copy of the same standard row is not this board's category.
      const onOne = await listCategoriesForBoard(db, fixture.tenantId, fixture.boards['ITIL One']);
      const parentOnOne = onOne.find((category) => category.standard_category_id === parent.standard_category_id)!;
      const problems = await findTicketFieldReferenceProblems(db, fixture.tenantId, {
        fields: {
          board_id: fixture.boards['ITIL Two'],
          status_id: statusId,
          priority_id: priorityId,
          category_id: parentOnOne.category_id,
          subcategory_id: null,
        },
        schedule: true,
      });
      expect(problems.map((problem) => problem.field)).toEqual(['category_id']);
    });

    it('T082: co-managed edit and the maintenance workflow action accept a standard category of the second board', async () => {
      const fixture = await createFixture([
        { name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' },
        { name: 'ITIL Two', categoryType: 'itil', priorityType: 'itil' },
      ]);
      await seedItilCategories(fixture, fixture.boards['ITIL One']);
      await seedItilCategories(fixture, fixture.boards['ITIL Two']);
      const onTwo = await listCategoriesForBoard(db, fixture.tenantId, fixture.boards['ITIL Two']);
      const parent = onTwo.find((category) => !category.parent_category)!;
      const child = onTwo.find((category) => category.parent_category === parent.category_id)!;

      // Both call `findBoardFieldProblems` with the ticket's board: a top-level row is accepted,
      // a subcategory passed as the category is reported as one.
      await expect(
        findBoardFieldProblems(db, fixture.tenantId, {
          boardId: fixture.boards['ITIL Two'],
          categoryId: parent.category_id,
        })
      ).resolves.toEqual([]);
      const asCategory = await findBoardFieldProblems(db, fixture.tenantId, {
        boardId: fixture.boards['ITIL Two'],
        categoryId: child.category_id,
      });
      expect(asCategory[0].message).toContain('is a subcategory');
      await expect(
        findBoardFieldProblems(db, fixture.tenantId, {
          boardId: fixture.boards['ITIL Two'],
          categoryId: parent.category_id,
          subcategoryId: child.category_id,
        })
      ).resolves.toEqual([]);
    });
  });

  describe('per-board seeding (F042)', () => {
    it('T083: a second ITIL board gets its own set and no row of any other board changes', async () => {
      const fixture = await createFixture([
        { name: 'Own Work' },
        { name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' },
        { name: 'ITIL Two', categoryType: 'itil', priorityType: 'itil' },
      ]);
      await seedItilCategories(fixture, fixture.boards['ITIL One']);
      const ownId = await insertCategory(fixture, 'Workstations', fixture.boards['Own Work']);
      const before = await tt(fixture.tenantId, 'categories')
        .whereNot({ board_id: fixture.boards['ITIL Two'] })
        .orderBy('category_id')
        .select('category_id', 'category_name', 'board_id', 'parent_category', 'standard_category_id', 'is_from_itil_standard');

      await seedItilCategories(fixture, fixture.boards['ITIL Two']);

      const after = await tt(fixture.tenantId, 'categories')
        .whereNot({ board_id: fixture.boards['ITIL Two'] })
        .orderBy('category_id')
        .select('category_id', 'category_name', 'board_id', 'parent_category', 'standard_category_id', 'is_from_itil_standard');
      expect(after).toEqual(before);
      expect(after.some((row: any) => row.category_id === ownId)).toBe(true);

      const onTwo = await listCategoriesForBoard(db, fixture.tenantId, fixture.boards['ITIL Two']);
      expect(onTwo).toHaveLength(await standardCategoryCount());
    });

    it('T084: a non-ITIL board’s category named like a standard one keeps its board and children', async () => {
      const fixture = await createFixture([
        { name: 'Own Work' },
        { name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' },
      ]);
      const standard = await standardTopLevel();
      const lookalike = await insertCategory(fixture, standard.category_name, fixture.boards['Own Work']);
      const lookalikeChild = await insertCategory(fixture, 'Own child', fixture.boards['Own Work'], {
        parent: lookalike,
      });

      await seedItilCategories(fixture, fixture.boards['ITIL One']);

      const row = await tt(fixture.tenantId, 'categories').where({ category_id: lookalike }).first();
      expect(row.board_id).toBe(fixture.boards['Own Work']);
      expect(row.is_from_itil_standard).toBeFalsy();
      expect(row.standard_category_id).toBeNull();
      const child = await tt(fixture.tenantId, 'categories').where({ category_id: lookalikeChild }).first();
      expect(child.parent_category).toBe(lookalike);
      expect(child.board_id).toBe(fixture.boards['Own Work']);
    });

    it('T085: two ITIL boards seeded at the same time end with one set each', async () => {
      const fixture = await createFixture([
        { name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' },
        { name: 'ITIL Two', categoryType: 'itil', priorityType: 'itil' },
      ]);

      await Promise.all([
        seedItilCategories(fixture, fixture.boards['ITIL One']),
        seedItilCategories(fixture, fixture.boards['ITIL Two']),
      ]);

      const expected = await standardCategoryCount();
      for (const boardId of [fixture.boards['ITIL One'], fixture.boards['ITIL Two']]) {
        const links = await tt(fixture.tenantId, 'categories')
          .where({ board_id: boardId })
          .whereNotNull('standard_category_id')
          .pluck('standard_category_id');
        expect(links).toHaveLength(expected);
        expect(new Set(links).size).toBe(expected);
      }

      // Re-seeding is a no-op, which is what makes board setup safe to retry.
      await seedItilCategories(fixture, fixture.boards['ITIL Two']);
      expect(
        await tt(fixture.tenantId, 'categories').where({ board_id: fixture.boards['ITIL Two'] }).count('* as n').first()
      ).toEqual({ n: String(expected) });
    });
  });

  describe('board delete takes its categories with it (F043)', () => {
    it('T086: deleting one of two ITIL boards leaves the other board’s set intact', async () => {
      const fixture = await createFixture([
        { name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' },
        { name: 'ITIL Two', categoryType: 'itil', priorityType: 'itil' },
      ]);
      await seedItilCategories(fixture, fixture.boards['ITIL One']);
      await seedItilCategories(fixture, fixture.boards['ITIL Two']);
      const { deleteBoard } = await import('../../../../packages/tickets/src/actions/board-actions/boardActions');

      const result = await deleteBoard(fixture.boards['ITIL Two'], true);
      expect(result.success).toBe(true);

      expect(
        await tt(fixture.tenantId, 'categories').where({ board_id: fixture.boards['ITIL Two'] }).count('* as n').first()
      ).toEqual({ n: '0' });
      const onOne = await listCategoriesForBoard(db, fixture.tenantId, fixture.boards['ITIL One']);
      expect(onOne).toHaveLength(await standardCategoryCount());
    });

    it('T101: a category a ticket on another board still holds is kept without a board', async () => {
      const fixture = await createFixture([
        { name: 'Own Work' },
        { name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' },
        { name: 'ITIL Two', categoryType: 'itil', priorityType: 'itil' },
      ]);
      await seedItilCategories(fixture, fixture.boards['ITIL One']);
      await seedItilCategories(fixture, fixture.boards['ITIL Two']);
      const clientId = await insertClient(fixture);
      const ownStatus = await insertStatus(fixture, fixture.boards['Own Work']);
      const priorityId = await insertItilPriority(fixture, 3);
      const onTwo = await listCategoriesForBoard(db, fixture.tenantId, fixture.boards['ITIL Two']);
      const kept = onTwo.find((category) => !category.parent_category)!;

      // A ticket on another board holding one of the deleted board's categories: rule-breaking
      // data that must not block the delete and must not lose its value (D3).
      await insertTicket(fixture, {
        boardId: fixture.boards['Own Work'],
        statusId: ownStatus,
        priorityId,
        clientId,
        categoryId: kept.category_id,
      });

      const { deleteBoard } = await import('../../../../packages/tickets/src/actions/board-actions/boardActions');
      const result = await deleteBoard(fixture.boards['ITIL Two'], true);
      expect(result.success).toBe(true);

      const keptRow = await tt(fixture.tenantId, 'categories').where({ category_id: kept.category_id }).first();
      expect(keptRow.board_id).toBeNull();
      expect(
        await tt(fixture.tenantId, 'categories').where({ board_id: fixture.boards['ITIL Two'] }).count('* as n').first()
      ).toEqual({ n: '0' });
      const onOne = await listCategoriesForBoard(db, fixture.tenantId, fixture.boards['ITIL One']);
      expect(onOne).toHaveLength(await standardCategoryCount());
    });
  });

  describe('a standard row of an ITIL board is locked (F044, F045, F046)', () => {
    it('T088: web update, re-parent and delete of a standard row are refused', async () => {
      const fixture = await createFixture([{ name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' }]);
      await seedItilCategories(fixture, fixture.boards['ITIL One']);
      const rows = await listCategoriesForBoard(db, fixture.tenantId, fixture.boards['ITIL One']);
      const parent = rows.find((category) => !category.parent_category)!;
      const otherParent = rows.find(
        (category) => !category.parent_category && category.category_id !== parent.category_id
      )!;

      const renamed = (await updateTicketCategory(parent.category_id, { category_name: 'Renamed' })) as any;
      expect(renamed.actionError ?? renamed.message).toContain('Standard ITIL category');

      const reparented = (await updateCategory(parent.category_id, { board_id: fixture.boards['ITIL One'] })) as any;
      expect(reparented.actionError ?? reparented.message).toContain('Standard ITIL category');

      const moved = (await updateTicketCategory(parent.category_id, { parent_category: otherParent.category_id })) as any;
      expect(moved.actionError ?? moved.message).toContain('Standard ITIL category');

      const deleted = await deleteCategory(parent.category_id, true);
      expect(deleted.success).toBe(false);
      expect(deleted.message).toContain('Standard ITIL category');

      const stillThere = await tt(fixture.tenantId, 'categories').where({ category_id: parent.category_id }).first();
      expect(stillThere.category_name).toBe(parent.category_name);
    });

    it('T089: the reference-data delete of a standard row is refused', async () => {
      const fixture = await createFixture([{ name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' }]);
      await seedItilCategories(fixture, fixture.boards['ITIL One']);
      const parent = (await listCategoriesForBoard(db, fixture.tenantId, fixture.boards['ITIL One']))
        .find((category) => !category.parent_category)!;

      const result = await deleteReferenceDataItem('categories', parent.category_id);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Standard ITIL category');
      expect(
        await tt(fixture.tenantId, 'categories').where({ category_id: parent.category_id }).first()
      ).toBeTruthy();
    });

    it('T090: adding a category is refused on an ITIL board and allowed on a non-ITIL board', async () => {
      const fixture = await createFixture([
        { name: 'Own Work' },
        { name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' },
      ]);
      await seedItilCategories(fixture, fixture.boards['ITIL One']);

      const refused = (await createCategory({
        category_name: 'Hand made',
        board_id: fixture.boards['ITIL One'],
      })) as any;
      expect(refused.actionError ?? refused.message).toContain('standard ITIL categories');

      const created = (await createCategory({
        category_name: 'Hand made',
        board_id: fixture.boards['Own Work'],
      })) as any;
      expect(created.category_id).toBeTruthy();
      expect(created.board_id).toBe(fixture.boards['Own Work']);
    });
  });

  describe('copying between boards (F047)', () => {
    it('T091: an ITIL board is no copy target; copying out of one creates plain categories', async () => {
      const fixture = await createFixture([
        { name: 'Own Work' },
        { name: 'Other Work' },
        { name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' },
      ]);
      await seedItilCategories(fixture, fixture.boards['ITIL One']);
      const ownId = await insertCategory(fixture, 'Workstations', fixture.boards['Own Work']);

      const refused = (await copyTicketCategoriesToBoard(
        fixture.boards['Own Work'],
        fixture.boards['ITIL One'],
        [ownId]
      )) as any;
      expect(refused.actionError ?? refused.message).toContain('standard ITIL categories');

      const onItil = (await listCategoriesForBoard(db, fixture.tenantId, fixture.boards['ITIL One']))
        .filter((category) => !category.parent_category)
        .slice(0, 2);
      const copied = (await copyTicketCategoriesToBoard(
        fixture.boards['ITIL One'],
        fixture.boards['Other Work'],
        onItil.map((category) => category.category_id)
      )) as any;
      expect(copied.created).toBe(2);
      const copies = await tt(fixture.tenantId, 'categories').where({ board_id: fixture.boards['Other Work'] });
      expect(copies).toHaveLength(2);
      expect(copies.every((row: any) => !row.is_from_itil_standard)).toBe(true);
      expect(copies.every((row: any) => row.standard_category_id === null)).toBe(true);
    });
  });

  describe('write whitelist and permissions (F048, F049)', () => {
    it('T092: updateTicketCategory keeps the board, the flag and the standard link out of its input', async () => {
      const fixture = await createFixture([
        { name: 'Own Work' },
        { name: 'Other Work' },
      ]);
      const standard = await standardTopLevel();
      const categoryId = await insertCategory(fixture, 'Workstations', fixture.boards['Own Work']);

      const updated = (await updateTicketCategory(categoryId, {
        category_name: 'Workstations renamed',
        board_id: fixture.boards['Other Work'],
        is_from_itil_standard: true,
        standard_category_id: standard.id,
      } as any)) as any;

      expect(updated.category_name).toBe('Workstations renamed');
      expect(updated.board_id).toBe(fixture.boards['Own Work']);
      expect(updated.is_from_itil_standard).toBeFalsy();
      expect(updated.standard_category_id).toBeNull();
    });

    it('T093: each category mutation is refused without the ticket_settings permission', async () => {
      const fixture = await createFixture([{ name: 'Own Work' }]);
      const categoryId = await insertCategory(fixture, 'Workstations', fixture.boards['Own Work']);
      permissionRef.allow = false;

      // `Permission denied: …` is mapped to a permissionError return, not an actionError.
      const updatedViaTicketAction = (await updateTicketCategory(categoryId, { category_name: 'Nope' })) as any;
      expect(updatedViaTicketAction.permissionError).toContain('Permission denied');

      const updated = (await updateCategory(categoryId, { category_name: 'Nope' })) as any;
      expect(updated.permissionError).toContain('Permission denied');

      const deleted = await deleteCategory(categoryId, true);
      expect(deleted.success).toBe(false);
      expect(deleted.message).toContain('Permission denied');

      const referenceDelete = await deleteReferenceDataItem('categories', categoryId);
      expect(referenceDelete.success).toBe(false);
      expect(referenceDelete.message).toContain('Permission denied');

      const row = await tt(fixture.tenantId, 'categories').where({ category_id: categoryId }).first();
      expect(row.category_name).toBe('Workstations');
    });
  });

  describe('REST category writes (F045, F050)', () => {
    it('T089: REST update and delete of a standard row on an ITIL board are refused', async () => {
      const fixture = await createFixture([{ name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' }]);
      await seedItilCategories(fixture, fixture.boards['ITIL One']);
      const rows = await listCategoriesForBoard(db, fixture.tenantId, fixture.boards['ITIL One']);
      const parent = rows.find((category) => !category.parent_category)!;
      const service = await categoryService(fixture);
      const context = { tenant: fixture.tenantId, userId: fixture.userId } as any;

      await expect(
        service.updateTicketCategory(parent.category_id, { category_name: 'Renamed' } as any, context)
      ).rejects.toThrow('Standard ITIL category');
      await expect(service.deleteTicketCategory(parent.category_id, context)).rejects.toThrow(
        'Standard ITIL category'
      );
      await expect(
        service.moveCategory(parent.category_id, null, context)
      ).rejects.toThrow('Standard ITIL category');
      await expect(
        service.createTicketCategory(
          { category_name: 'Hand made', board_id: fixture.boards['ITIL One'] } as any,
          context
        )
      ).rejects.toThrow('standard ITIL categories');
    });

    it('T094: REST delete of a category used only as a ticket’s subcategory is refused', async () => {
      const fixture = await createFixture([{ name: 'Own Work' }]);
      const parentId = await insertCategory(fixture, 'Workstations', fixture.boards['Own Work']);
      const childId = await insertCategory(fixture, 'Docking stations', fixture.boards['Own Work'], {
        parent: parentId,
      });
      const clientId = await insertClient(fixture);
      const statusId = await insertStatus(fixture, fixture.boards['Own Work']);
      const priorityId = await insertItilPriority(fixture, 3);
      await insertTicket(fixture, {
        boardId: fixture.boards['Own Work'],
        statusId,
        priorityId,
        clientId,
        categoryId: parentId,
        subcategoryId: childId,
      });

      const service = await categoryService(fixture);
      const context = { tenant: fixture.tenantId, userId: fixture.userId } as any;
      await expect(service.deleteTicketCategory(childId, context)).rejects.toThrow('in use by tickets');
      expect(await tt(fixture.tenantId, 'categories').where({ category_id: childId }).first()).toBeTruthy();
    });
  });

  describe('CSV import matches within the row’s board (F052, F055)', () => {
    it('T097: an import to the second ITIL board matches a standard category by name', async () => {
      const fixture = await createFixture([
        { name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' },
        { name: 'ITIL Two', categoryType: 'itil', priorityType: 'itil' },
      ]);
      await seedItilCategories(fixture, fixture.boards['ITIL One']);
      await seedItilCategories(fixture, fixture.boards['ITIL Two']);
      await insertClient(fixture);
      const standard = await standardTopLevel();
      const onTwo = await listCategoriesForBoard(db, fixture.tenantId, fixture.boards['ITIL Two']);
      const expectedId = onTwo.find((category) => category.standard_category_id === standard.id)!.category_id;

      const { getTicketImportReferenceData } = await import('../../../../packages/tickets/src/actions/ticketImportActions');
      const { validateTicketImportData, processTicketRows } = await import('../../../../packages/tickets/src/lib/ticketImportUtils');
      const referenceData = (await getTicketImportReferenceData()) as any;
      const rows = [
        { title: 'One', client: 'Fixture client', board: 'ITIL Two', category: standard.category_name },
      ] as any[];

      const validation = validateTicketImportData(rows, referenceData, fixture.boards['ITIL Two']);
      expect(validation.unmatchedCategories).toEqual([]);
      const processed = processTicketRows(
        rows, referenceData, fixture.boards['ITIL Two'],
        [], [], [], [], [], [], [], [], false
      );
      expect(processed.tickets[0].category_id).toBe(expectedId);
    });

    it('T098: an unknown category on an ITIL board is reported and no category is created', async () => {
      const fixture = await createFixture([{ name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' }]);
      await seedItilCategories(fixture, fixture.boards['ITIL One']);
      await insertClient(fixture);
      const before = Number(
        (await tt(fixture.tenantId, 'categories').count('* as n').first() as any).n
      );

      const { getTicketImportReferenceData, importTickets } = await import('../../../../packages/tickets/src/actions/ticketImportActions');
      const { validateTicketImportData, processTicketRows } = await import('../../../../packages/tickets/src/lib/ticketImportUtils');
      const referenceData = (await getTicketImportReferenceData()) as any;
      const rows = [
        { title: 'One', client: 'Fixture client', board: 'ITIL One', category: 'Nowhere near standard' },
      ] as any[];

      const validation = validateTicketImportData(rows, referenceData, fixture.boards['ITIL One']);
      expect(validation.unmatchedCategories).toEqual(['Nowhere near standard']);

      const processed = processTicketRows(
        rows, referenceData, fixture.boards['ITIL One'],
        [], [], [], [], [], [], [], [], false
      );
      const result = (await importTickets(
        processed.tickets,
        [],
        [],
        [],
        [],
        [{ originalCategoryName: 'Nowhere near standard', boardId: fixture.boards['ITIL One'], action: 'create' } as any],
        fixture.boards['ITIL One']
      )) as any;
      expect(result.actionError ?? result.message ?? '').toContain('standard ITIL categories');

      expect(
        Number((await tt(fixture.tenantId, 'categories').count('* as n').first() as any).n)
      ).toBe(before);
    });

    it('T104: an import does not match a boardless category by name', async () => {
      const fixture = await createFixture([{ name: 'Own Work' }]);
      await insertClient(fixture);
      await insertCategory(fixture, 'Left behind', null);

      const { getTicketImportReferenceData } = await import('../../../../packages/tickets/src/actions/ticketImportActions');
      const { validateTicketImportData } = await import('../../../../packages/tickets/src/lib/ticketImportUtils');
      const referenceData = (await getTicketImportReferenceData()) as any;
      expect(referenceData.categoriesByBoard['_global']).toBeUndefined();

      const validation = validateTicketImportData(
        [{ title: 'One', client: 'Fixture client', category: 'Left behind' }] as any[],
        referenceData,
        fixture.boards['Own Work']
      );
      expect(validation.unmatchedCategories).toEqual(['Left behind']);
    });
  });

  describe('a category with no board (F055)', () => {
    it('T102: a boardless category is in no picker and is refused as a new selection', async () => {
      const fixture = await createFixture([{ name: 'Own Work' }]);
      const boardlessId = await insertCategory(fixture, 'Left behind', null);

      const list = await listCategoriesForBoard(db, fixture.tenantId, fixture.boards['Own Work']);
      expect(list.map((category) => category.category_id)).not.toContain(boardlessId);

      const problems = await findBoardFieldProblems(db, fixture.tenantId, {
        boardId: fixture.boards['Own Work'],
        categoryId: boardlessId,
      });
      expect(problems.map((problem) => problem.field)).toEqual(['category_id']);
      expect(problems[0].message).toContain('belongs to no board');
    });

    it('T103: a ticket holding a boardless category still saves a title and status change', async () => {
      const fixture = await createFixture([{ name: 'Own Work' }]);
      const boardlessId = await insertCategory(fixture, 'Left behind', null);
      const clientId = await insertClient(fixture);
      const statusId = await insertStatus(fixture, fixture.boards['Own Work']);
      const secondStatusId = uuidv4();
      await tt(fixture.tenantId, 'statuses').insert({
        tenant: fixture.tenantId,
        status_id: secondStatusId,
        name: 'In progress',
        board_id: fixture.boards['Own Work'],
        status_type: 'ticket',
        is_closed: false,
        is_default: false,
        order_number: 2,
        created_by: fixture.userId,
      });
      const priorityId = uuidv4();
      await tt(fixture.tenantId, 'priorities').insert({
        tenant: fixture.tenantId,
        priority_id: priorityId,
        priority_name: 'Own Low',
        color: '#111111',
        order_number: 1,
        item_type: 'ticket',
        is_from_itil_standard: false,
        created_by: fixture.userId,
      });
      const ticketId = await insertTicket(fixture, {
        boardId: fixture.boards['Own Work'],
        statusId,
        priorityId,
        clientId,
        categoryId: boardlessId,
      });

      const { findTicketPatchBoardFieldProblems } = await import('@alga-psa/shared/lib/tickets/boardFieldRules');
      // R5: the patch touches neither the category nor the board, so nothing is checked.
      await expect(
        findTicketPatchBoardFieldProblems(
          db,
          fixture.tenantId,
          { board_id: fixture.boards['Own Work'], category_id: boardlessId, priority_id: priorityId },
          { status_id: secondStatusId } as any
        )
      ).resolves.toEqual([]);

      await tt(fixture.tenantId, 'tickets')
        .where({ ticket_id: ticketId })
        .update({ title: 'Renamed', status_id: secondStatusId });
      const row = await tt(fixture.tenantId, 'tickets').where({ ticket_id: ticketId }).first();
      expect(row.title).toBe('Renamed');
      expect(row.category_id).toBe(boardlessId);
    });
  });

  describe('translateStandardCategoryForBoard (F056)', () => {
    it('T105: another ITIL board’s standard row translates to this board’s copy, parent and child', async () => {
      const fixture = await createFixture([
        { name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' },
        { name: 'ITIL Two', categoryType: 'itil', priorityType: 'itil' },
      ]);
      await seedItilCategories(fixture, fixture.boards['ITIL One']);
      await seedItilCategories(fixture, fixture.boards['ITIL Two']);
      const onOne = await listCategoriesForBoard(db, fixture.tenantId, fixture.boards['ITIL One']);
      const onTwo = await listCategoriesForBoard(db, fixture.tenantId, fixture.boards['ITIL Two']);
      const parentOnOne = onOne.find((category) => !category.parent_category)!;
      const childOnOne = onOne.find((category) => category.parent_category === parentOnOne.category_id)!;

      await expect(
        translateStandardCategoryForBoard(db, fixture.tenantId, parentOnOne.category_id, fixture.boards['ITIL Two'])
      ).resolves.toBe(
        onTwo.find((category) => category.standard_category_id === parentOnOne.standard_category_id)!.category_id
      );
      await expect(
        translateStandardCategoryForBoard(db, fixture.tenantId, childOnOne.category_id, fixture.boards['ITIL Two'])
      ).resolves.toBe(
        onTwo.find((category) => category.standard_category_id === childOnOne.standard_category_id)!.category_id
      );
      // A row already on the target board needs no translation.
      await expect(
        translateStandardCategoryForBoard(db, fixture.tenantId, parentOnOne.category_id, fixture.boards['ITIL One'])
      ).resolves.toBeNull();
    });

    it('T106: a non-standard category of another board, or a target board with no copy, translates to nothing', async () => {
      const fixture = await createFixture([
        { name: 'Own Work' },
        { name: 'Other Work' },
        { name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' },
      ]);
      await seedItilCategories(fixture, fixture.boards['ITIL One']);
      const ownId = await insertCategory(fixture, 'Workstations', fixture.boards['Own Work']);
      const parentOnItil = (await listCategoriesForBoard(db, fixture.tenantId, fixture.boards['ITIL One']))
        .find((category) => !category.parent_category)!;

      await expect(
        translateStandardCategoryForBoard(db, fixture.tenantId, ownId, fixture.boards['ITIL One'])
      ).resolves.toBeNull();
      await expect(
        translateStandardCategoryForBoard(db, fixture.tenantId, parentOnItil.category_id, fixture.boards['Other Work'])
      ).resolves.toBeNull();
    });
  });
});
