/**
 * T107–T118 — F057–F060 of `ee/plans/2026-11-21-itil-remediation` (`category-filters`).
 *
 * R9: where a category list spans boards, a standard category appears once and matching it matches
 * that standard category on every board in scope — in the ticket list filter, in a saved view and
 * in a checklist apply rule, because all three compile against the same ticket query schema.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { compilePredicateFragment } from '@alga-psa/predicates/sql';
import { createTicketQuerySchema } from '@alga-psa/shared/lib/ticketQuery/ticketQuerySchema';
import { standardCategoryFilterOptions } from '@alga-psa/shared/lib/tickets/standardCategoryFilterOptions';
import { ticketFiltersToPredicates } from '../../../../packages/tickets/src/lib/ticketFilterPredicates';
import { validateCapturedFilters } from '../../../../packages/tickets/src/lib/ticketViewSettings';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const HOOK_TIMEOUT = 180_000;
const NOW = '2026-11-22T12:00:00.000Z';

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
  await tt(tenantId, 'ticket_checklist_items').del();
  await tt(tenantId, 'checklist_template_apply_rules').del();
  await tt(tenantId, 'checklist_template_items').del();
  await tt(tenantId, 'checklist_templates').del();
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

interface Fixture {
  tenantId: string;
  userId: string;
  clientId: string;
  /** board name → board id */
  boards: Record<string, string>;
  statuses: Record<string, string>;
  priorityId: string;
  /** board id → (standard id → category id) */
  standardCopies: Record<string, Record<string, string>>;
  /** The standard ids used, parent first. */
  standardParentId: string;
  standardChildId: string;
}

/**
 * Three ITIL boards and one non-ITIL board, every ITIL board holding its own copy of a two-row
 * stand-in standard set, with one ticket per ITIL board on the parent copy.
 */
async function createFixture(options: { extraOwnBoards?: string[] } = {}): Promise<Fixture> {
  const tenantId = uuidv4();
  const userId = uuidv4();
  const clientId = uuidv4();
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
  await tt(tenantId, 'clients').insert({ tenant: tenantId, client_id: clientId, client_name: 'Fixture client' });

  const itilBoardNames = ['ITIL One', 'ITIL Two', 'ITIL Three'];
  const ownBoardNames = ['Own Work', ...(options.extraOwnBoards ?? [])];
  const boards: Record<string, string> = {};
  const statuses: Record<string, string> = {};
  const boardRows: any[] = [];
  const statusRows: any[] = [];
  [...ownBoardNames, ...itilBoardNames].forEach((name, index) => {
    const boardId = uuidv4();
    const statusId = uuidv4();
    boards[name] = boardId;
    statuses[name] = statusId;
    boardRows.push({
      tenant: tenantId,
      board_id: boardId,
      board_name: name,
      display_order: (index + 1) * 10,
      is_default: index === 0,
      is_inactive: false,
      category_type: itilBoardNames.includes(name) ? 'itil' : 'custom',
      priority_type: itilBoardNames.includes(name) ? 'itil' : 'custom',
    });
    statusRows.push({
      tenant: tenantId,
      status_id: statusId,
      name: 'New',
      board_id: boardId,
      status_type: 'ticket',
      is_closed: false,
      is_default: true,
      order_number: 1,
      created_by: userId,
    });
  });
  await tt(tenantId, 'boards').insert(boardRows);
  await tt(tenantId, 'statuses').insert(statusRows);

  const priorityId = uuidv4();
  await tt(tenantId, 'priorities').insert({
    tenant: tenantId,
    priority_id: priorityId,
    priority_name: 'P3 - ITIL',
    color: '#DC2626',
    order_number: 103,
    item_type: 'ticket',
    is_from_itil_standard: true,
    itil_priority_level: 3,
    created_by: userId,
  });

  // Two standard rows stand in for the product's set: a parent and one child of it.
  const standard = await db('standard_categories')
    .where({ is_itil_standard: true })
    .whereNull('parent_category_uuid')
    .orderBy('display_order', 'asc')
    .first('id', 'category_name');
  const standardChild = await db('standard_categories')
    .where({ is_itil_standard: true, parent_category_uuid: standard.id })
    .orderBy('display_order', 'asc')
    .first('id', 'category_name');

  const standardCopies: Record<string, Record<string, string>> = {};
  for (const name of itilBoardNames) {
    const boardId = boards[name];
    const parentId = uuidv4();
    const childId = uuidv4();
    standardCopies[boardId] = { [standard.id]: parentId, [standardChild.id]: childId };
    await tt(tenantId, 'categories').insert([
      {
        tenant: tenantId,
        category_id: parentId,
        category_name: standard.category_name,
        board_id: boardId,
        parent_category: null,
        standard_category_id: standard.id,
        is_from_itil_standard: true,
        display_order: 1,
        created_by: userId,
      },
      {
        tenant: tenantId,
        category_id: childId,
        category_name: standardChild.category_name,
        board_id: boardId,
        parent_category: parentId,
        standard_category_id: standardChild.id,
        is_from_itil_standard: true,
        display_order: 2,
        created_by: userId,
      },
    ]);
  }

  return {
    tenantId,
    userId,
    clientId,
    boards,
    statuses,
    priorityId,
    standardCopies,
    standardParentId: standard.id,
    standardChildId: standardChild.id,
  };
}

async function insertTicket(
  fixture: Fixture,
  boardName: string,
  values: { title: string; categoryId?: string | null; subcategoryId?: string | null }
): Promise<string> {
  const ticketId = uuidv4();
  await tt(fixture.tenantId, 'tickets').insert({
    tenant: fixture.tenantId,
    ticket_id: ticketId,
    ticket_number: `T-${ticketId.slice(0, 8)}`,
    title: values.title,
    board_id: fixture.boards[boardName],
    status_id: fixture.statuses[boardName],
    priority_id: fixture.priorityId,
    client_id: fixture.clientId,
    category_id: values.categoryId ?? null,
    subcategory_id: values.subcategoryId ?? null,
    entered_by: fixture.userId,
    entered_at: NOW,
  });
  return ticketId;
}

/** Runs a ticket-list filter set through the real predicate compiler against the database. */
async function matchingTicketTitles(fixture: Fixture, filters: any): Promise<string[]> {
  const schema = createTicketQuerySchema(() => NOW);
  const where = ticketFiltersToPredicates(filters, { nowIso: NOW, timeZone: 'UTC' });
  const fragment = compilePredicateFragment(schema, where, { rootAlias: 't' });
  const rows = await tenantDb(db, fixture.tenantId)
    .table('tickets as t')
    .whereRaw(fragment.sql, fragment.bindings as any)
    .orderBy('t.title', 'asc')
    .pluck('t.title');
  return rows as string[];
}

/** Matches one ticket against a checklist apply rule's `where`, the way applyTemplates does. */
async function ruleMatches(fixture: Fixture, ticketId: string, where: any): Promise<boolean> {
  const schema = createTicketQuerySchema(() => NOW);
  const fragment = compilePredicateFragment(schema, where, { rootAlias: 't' });
  const row = (await tenantDb(db, fixture.tenantId)
    .table('tickets as t')
    .where('t.ticket_id', ticketId)
    .select(db.raw(`(${fragment.sql}) AS ??`, [...(fragment.bindings as any[]), 'matched']))
    .first()) as { matched: boolean };
  return row.matched === true;
}

describe('ITIL categories across boards in filters (integration)', () => {
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

  describe('one entry per standard category (F057)', () => {
    it('T107: a tenant with three ITIL boards lists the standard category once', async () => {
      const fixture = await createFixture();
      const rows = await tt(fixture.tenantId, 'categories')
        .orderBy('display_order', 'asc')
        .orderBy('category_name', 'asc')
        .select('category_id', 'category_name', 'board_id', 'parent_category', 'standard_category_id');

      const { categories, aliases } = standardCategoryFilterOptions(rows as any[]);
      expect(rows).toHaveLength(6);
      expect(categories).toHaveLength(2);
      expect(new Set(categories.map((category: any) => category.standard_category_id)).size).toBe(2);
      // Both representatives come from one board, so the parent/child shape still reads.
      const parent = categories.find((category: any) => !category.parent_category)!;
      const child = categories.find((category: any) => category.parent_category)!;
      expect(child.parent_category).toBe(parent.category_id);
      // Every id that is no longer listed is translatable to the one that is.
      expect(Object.keys(aliases)).toHaveLength(4);
      for (const [from, to] of Object.entries(aliases)) {
        expect(categories.some((category: any) => category.category_id === to)).toBe(true);
        expect(from).not.toBe(to);
      }
    });

    it('T108: two non-ITIL boards with a same-named own category are listed exactly as before', async () => {
      const fixture = await createFixture({ extraOwnBoards: ['Second Own'] });
      for (const boardName of ['Own Work', 'Second Own']) {
        await tt(fixture.tenantId, 'categories').insert({
          tenant: fixture.tenantId,
          category_id: uuidv4(),
          category_name: 'Workstations',
          board_id: fixture.boards[boardName],
          parent_category: null,
          display_order: 5,
          created_by: fixture.userId,
        });
      }

      const rows = await tt(fixture.tenantId, 'categories')
        .whereNull('standard_category_id')
        .orderBy('category_name', 'asc')
        .select('category_id', 'category_name', 'board_id', 'parent_category', 'standard_category_id');
      const { categories, aliases } = standardCategoryFilterOptions(rows as any[]);
      expect(categories).toEqual(rows);
      expect(aliases).toEqual({});
    });
  });

  describe('standard-aware matching in the predicate engine (F058)', () => {
    it('T110: selecting the standard category returns its tickets from all three ITIL boards', async () => {
      const fixture = await createFixture();
      await insertTicket(fixture, 'ITIL One', {
        title: 'one',
        categoryId: fixture.standardCopies[fixture.boards['ITIL One']][fixture.standardParentId],
      });
      await insertTicket(fixture, 'ITIL Two', {
        title: 'two',
        categoryId: fixture.standardCopies[fixture.boards['ITIL Two']][fixture.standardParentId],
      });
      await insertTicket(fixture, 'ITIL Three', {
        title: 'three',
        categoryId: fixture.standardCopies[fixture.boards['ITIL Three']][fixture.standardParentId],
      });
      await insertTicket(fixture, 'Own Work', { title: 'uncategorised' });

      const pick = fixture.standardCopies[fixture.boards['ITIL One']][fixture.standardParentId];
      await expect(matchingTicketTitles(fixture, { categoryIds: [pick] })).resolves.toEqual([
        'one',
        'three',
        'two',
      ]);
    });

    it('T111: a link holding one board’s id, opened on all boards, returns every ITIL board’s tickets', async () => {
      const fixture = await createFixture();
      await insertTicket(fixture, 'ITIL One', {
        title: 'one',
        categoryId: fixture.standardCopies[fixture.boards['ITIL One']][fixture.standardParentId],
      });
      await insertTicket(fixture, 'ITIL Three', {
        title: 'three',
        categoryId: fixture.standardCopies[fixture.boards['ITIL Three']][fixture.standardParentId],
      });

      // The URL carries `categoryId`, the single-value form, of the *third* board's copy.
      const linked = fixture.standardCopies[fixture.boards['ITIL Three']][fixture.standardParentId];
      await expect(matchingTicketTitles(fixture, { categoryId: linked })).resolves.toEqual(['one', 'three']);
    });

    it('T112: excluding a standard category excludes it on every board', async () => {
      const fixture = await createFixture();
      await insertTicket(fixture, 'ITIL One', {
        title: 'one',
        categoryId: fixture.standardCopies[fixture.boards['ITIL One']][fixture.standardParentId],
      });
      await insertTicket(fixture, 'ITIL Two', {
        title: 'two',
        categoryId: fixture.standardCopies[fixture.boards['ITIL Two']][fixture.standardParentId],
      });
      await insertTicket(fixture, 'ITIL Three', { title: 'no category' });

      const pick = fixture.standardCopies[fixture.boards['ITIL One']][fixture.standardParentId];
      await expect(matchingTicketTitles(fixture, { excludeCategoryIds: [pick] })).resolves.toEqual(['no category']);
    });

    it('T113: on a single board’s tab the filter matches only that board’s tickets', async () => {
      const fixture = await createFixture();
      await insertTicket(fixture, 'ITIL One', {
        title: 'one',
        categoryId: fixture.standardCopies[fixture.boards['ITIL One']][fixture.standardParentId],
      });
      await insertTicket(fixture, 'ITIL Two', {
        title: 'two',
        categoryId: fixture.standardCopies[fixture.boards['ITIL Two']][fixture.standardParentId],
      });

      const pick = fixture.standardCopies[fixture.boards['ITIL One']][fixture.standardParentId];
      await expect(
        matchingTicketTitles(fixture, { boardIds: [fixture.boards['ITIL Two']], categoryIds: [pick] })
      ).resolves.toEqual(['two']);
    });

    it('T117: a checklist rule on a standard category with no board matches on every ITIL board', async () => {
      const fixture = await createFixture();
      const onOne = await insertTicket(fixture, 'ITIL One', {
        title: 'one',
        categoryId: fixture.standardCopies[fixture.boards['ITIL One']][fixture.standardParentId],
      });
      const onTwo = await insertTicket(fixture, 'ITIL Two', {
        title: 'two',
        categoryId: fixture.standardCopies[fixture.boards['ITIL Two']][fixture.standardParentId],
      });
      const uncategorised = await insertTicket(fixture, 'ITIL Three', { title: 'three' });

      // A rule with no board names the category alone — the shape the checklist settings screen
      // writes, and the one the apply path compiles against this schema.
      const where = {
        join: 'and',
        clauses: [
          {
            path: 'category_id',
            operator: 'equals',
            value: fixture.standardCopies[fixture.boards['ITIL One']][fixture.standardParentId],
          },
        ],
      };
      await expect(ruleMatches(fixture, onOne, where)).resolves.toBe(true);
      await expect(ruleMatches(fixture, onTwo, where)).resolves.toBe(true);
      await expect(ruleMatches(fixture, uncategorised, where)).resolves.toBe(false);
    });

    it('T118: a checklist rule on a non-standard category matches only that category row', async () => {
      const fixture = await createFixture();
      const ownCategoryId = uuidv4();
      const otherOwnCategoryId = uuidv4();
      await tt(fixture.tenantId, 'categories').insert([
        {
          tenant: fixture.tenantId,
          category_id: ownCategoryId,
          category_name: 'Workstations',
          board_id: fixture.boards['Own Work'],
          parent_category: null,
          display_order: 5,
          created_by: fixture.userId,
        },
        {
          tenant: fixture.tenantId,
          category_id: otherOwnCategoryId,
          category_name: 'Workstations',
          board_id: fixture.boards['ITIL One'],
          parent_category: null,
          display_order: 6,
          created_by: fixture.userId,
        },
      ]);
      const onOwn = await insertTicket(fixture, 'Own Work', { title: 'own', categoryId: ownCategoryId });
      const onOther = await insertTicket(fixture, 'ITIL One', { title: 'other', categoryId: otherOwnCategoryId });

      const where = {
        join: 'and',
        clauses: [{ path: 'category_id', operator: 'equals', value: ownCategoryId }],
      };
      await expect(ruleMatches(fixture, onOwn, where)).resolves.toBe(true);
      await expect(ruleMatches(fixture, onOther, where)).resolves.toBe(false);
    });
  });

  describe('the saved-view loader translates instead of dropping (F059)', () => {
    it('T114: another ITIL board’s copy is translated to the listed one and nothing is dropped', async () => {
      const fixture = await createFixture();
      const rows = await tt(fixture.tenantId, 'categories')
        .orderBy('display_order', 'asc')
        .select('category_id', 'category_name', 'board_id', 'parent_category', 'standard_category_id');
      const { categories, aliases } = standardCategoryFilterOptions(rows as any[]);
      const listedId = categories.find((category: any) => !category.parent_category)!.category_id;
      const storedId = Object.keys(aliases).find((id) => aliases[id] === listedId)!;
      expect(storedId).toBeTruthy();

      const validated = validateCapturedFilters(
        { categoryId: storedId, categoryIds: [storedId], excludeCategoryIds: [storedId] },
        {
          categoryIds: categories.map((category: any) => category.category_id),
          categoryAliases: aliases,
        }
      );
      expect(validated.categoryId).toBe(listedId);
      expect(validated.categoryIds).toEqual([listedId]);
      expect(validated.excludeCategoryIds).toEqual([listedId]);
    });

    it('T115: an id that is no standard category of any board is still dropped', async () => {
      const fixture = await createFixture();
      const rows = await tt(fixture.tenantId, 'categories').select(
        'category_id',
        'category_name',
        'board_id',
        'parent_category',
        'standard_category_id'
      );
      const { categories, aliases } = standardCategoryFilterOptions(rows as any[]);

      const validated = validateCapturedFilters(
        { categoryId: uuidv4(), categoryIds: [uuidv4()] },
        {
          categoryIds: categories.map((category: any) => category.category_id),
          categoryAliases: aliases,
        }
      );
      expect(validated.categoryId).toBeUndefined();
      expect(validated.categoryIds).toBeUndefined();
    });
  });

  describe('REST ticket stats (F060)', () => {
    it('T116: tickets_by_category has one entry for the standard category, counting every ITIL board', async () => {
      const fixture = await createFixture();
      await insertTicket(fixture, 'ITIL One', {
        title: 'one',
        categoryId: fixture.standardCopies[fixture.boards['ITIL One']][fixture.standardParentId],
      });
      await insertTicket(fixture, 'ITIL Two', {
        title: 'two',
        categoryId: fixture.standardCopies[fixture.boards['ITIL Two']][fixture.standardParentId],
      });
      await insertTicket(fixture, 'ITIL Three', { title: 'three' });

      // The controller groups by `category_name`, so the three boards' copies of one standard row
      // collapse into one entry without any change here (F060).
      const rows = (await tenantDb(db, fixture.tenantId)
        .table('tickets as t')
        .leftJoin('categories as c', function () {
          this.on('c.tenant', '=', 't.tenant').andOn('c.category_id', '=', 't.category_id');
        })
        .select('c.category_name')) as Array<{ category_name: string | null }>;
      const byCategory = rows.reduce<Record<string, number>>((acc, row) => {
        const key = row.category_name ? String(row.category_name) : 'null';
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {});

      const standardName = (await db('standard_categories')
        .where({ id: fixture.standardParentId })
        .first('category_name')) as { category_name: string };
      expect(byCategory[standardName.category_name]).toBe(2);
      expect(Object.keys(byCategory).filter((key) => key === standardName.category_name)).toHaveLength(1);
    });
  });
});
