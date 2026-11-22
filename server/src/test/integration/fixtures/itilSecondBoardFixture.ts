/**
 * F020 of `ee/plans/2026-11-21-itil-remediation` (`test-harness`).
 *
 * A tenant shaped like the one the bugs live on:
 *
 * - `Own Work` — the tenant's own categories and priorities;
 * - `ITIL One` — the first board on which ITIL was enabled;
 * - `ITIL Two` — a second ITIL board, which is where every picker and writer used to go wrong;
 * - `Legacy Mixed` — the tenant's own categories with ITIL priorities, a board the server accepts
 *   today and which must keep working (D4) although no new one can be created.
 *
 * Both priority families exist, because priorities are tenant-wide in two families (R3).
 *
 * The ITIL categories are seeded the way the product seeds them after the `category-schema` and
 * `category-rules` groups: every ITIL board owns its own copy of the standard set, each row
 * carrying the `standard_categories.id` it came from (D9). `expectedItilCategoryOwnership` says
 * which shape the fixture is building. `ITIL Two` also carries one category that is not a standard
 * row, which R2 says stays attached and is listed.
 */
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

export type ItilCategoryOwnership = 'single-set-on-first-itil-board' | 'per-board-copies';

/** The shape the fixture builds. Flipped by the category groups, with their migration. */
export const expectedItilCategoryOwnership: ItilCategoryOwnership = 'per-board-copies';

export interface ItilSecondBoardFixture {
  tenantId: string;
  userId: string;
  clientId: string;
  contactId: string;
  boards: {
    own: string;
    itilOne: string;
    itilTwo: string;
    mixed: string;
  };
  statuses: {
    own: string;
    itilOne: string;
    itilTwo: string;
    mixed: string;
  };
  /** The tenant's own ticket priorities, lowest `order_number` first. */
  ownPriorityIds: string[];
  /** The five ITIL ticket priorities by `itil_priority_level`. */
  itilPriorityIds: Record<number, string>;
  /** The tenant's own categories on `Own Work`: a parent and its child. */
  ownCategory: { parentId: string; childId: string };
  /** `ITIL One`'s copies of the standard category rows, keyed by `standard_categories.id`. */
  itilCategoryIdsByStandardId: Record<string, string>;
  /** Every ITIL board's copies, keyed by board id then `standard_categories.id`. */
  itilCategoryIdsByBoard: Record<string, Record<string, string>>;
  /** A category of `ITIL Two` that is not a standard row: it stays attached and is listed (R2). */
  itilTwoOwnCategoryId: string;
}

function tt(db: Knex, tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

function tenantRows(db: Knex) {
  return tenantDb(db, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

export async function createItilSecondBoardFixture(db: Knex): Promise<ItilSecondBoardFixture> {
  const tenantId = uuidv4();
  const userId = uuidv4();
  const clientId = uuidv4();
  const contactId = uuidv4();

  await tenantRows(db).insert({
    tenant: tenantId,
    client_name: `Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
  });

  await tt(db, tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `user-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: `user-${tenantId.slice(0, 8)}@example.com`,
    user_type: 'internal',
  });

  await tt(db, tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: 'Fixture client',
  });

  await tt(db, tenantId, 'contacts').insert({
    tenant: tenantId,
    contact_name_id: contactId,
    full_name: 'Fixture Contact',
    email: `contact-${tenantId.slice(0, 8)}@example.com`,
    client_id: clientId,
  });

  const boards = {
    own: uuidv4(),
    itilOne: uuidv4(),
    itilTwo: uuidv4(),
    mixed: uuidv4(),
  };

  await tt(db, tenantId, 'boards').insert([
    {
      tenant: tenantId,
      board_id: boards.own,
      board_name: 'Own Work',
      display_order: 10,
      is_default: true,
      is_inactive: false,
      category_type: 'custom',
      priority_type: 'custom',
    },
    {
      tenant: tenantId,
      board_id: boards.itilOne,
      board_name: 'ITIL One',
      display_order: 20,
      is_default: false,
      is_inactive: false,
      category_type: 'itil',
      priority_type: 'itil',
    },
    {
      tenant: tenantId,
      board_id: boards.itilTwo,
      board_name: 'ITIL Two',
      display_order: 30,
      is_default: false,
      is_inactive: false,
      category_type: 'itil',
      priority_type: 'itil',
    },
    {
      // A board the server accepts today: the tenant's own categories, ITIL priorities.
      tenant: tenantId,
      board_id: boards.mixed,
      board_name: 'Legacy Mixed',
      display_order: 40,
      is_default: false,
      is_inactive: false,
      category_type: 'custom',
      priority_type: 'itil',
    },
  ]);

  const statuses = {
    own: uuidv4(),
    itilOne: uuidv4(),
    itilTwo: uuidv4(),
    mixed: uuidv4(),
  };

  await tt(db, tenantId, 'statuses').insert(
    (Object.keys(statuses) as Array<keyof typeof statuses>).map((key) => ({
      tenant: tenantId,
      status_id: statuses[key],
      name: 'New',
      board_id: boards[key],
      status_type: 'ticket',
      is_closed: false,
      is_default: true,
      order_number: 1,
      created_by: userId,
    }))
  );

  // The tenant's own ticket priorities. `Own Low` is the lowest order, so R7 picks it as the
  // default of a board with the tenant's own priorities.
  const ownPriorityIds = [uuidv4(), uuidv4()];
  await tt(db, tenantId, 'priorities').insert([
    {
      tenant: tenantId,
      priority_id: ownPriorityIds[0],
      priority_name: 'Own Low',
      color: '#3B82F6',
      order_number: 1,
      item_type: 'ticket',
      is_from_itil_standard: false,
      created_by: userId,
    },
    {
      tenant: tenantId,
      priority_id: ownPriorityIds[1],
      priority_name: 'Own High',
      color: '#DC2626',
      order_number: 2,
      item_type: 'ticket',
      is_from_itil_standard: false,
      created_by: userId,
    },
  ]);

  // The five ITIL ticket priorities, as ITIL seeding creates them: flagged, with a level.
  const standardItilPriorities = await db('standard_priorities')
    .where({ is_itil_standard: true, item_type: 'ticket' })
    .orderBy('itil_priority_level', 'asc')
    .select('priority_name', 'color', 'order_number', 'itil_priority_level');
  if (standardItilPriorities.length === 0) {
    throw new Error('standard_priorities holds no ITIL rows: the fixture cannot build an ITIL board');
  }

  const itilPriorityIds: Record<number, string> = {};
  await tt(db, tenantId, 'priorities').insert(
    standardItilPriorities.map((row: any) => {
      const priorityId = uuidv4();
      itilPriorityIds[Number(row.itil_priority_level)] = priorityId;
      return {
        tenant: tenantId,
        priority_id: priorityId,
        priority_name: row.priority_name,
        color: row.color,
        order_number: row.order_number,
        item_type: 'ticket',
        is_from_itil_standard: true,
        itil_priority_level: row.itil_priority_level,
        created_by: userId,
      };
    })
  );

  // A project-task priority, so a lister that forgets `item_type` is caught.
  await tt(db, tenantId, 'priorities').insert({
    tenant: tenantId,
    priority_id: uuidv4(),
    priority_name: 'Task Normal',
    color: '#6B7280',
    order_number: 1,
    item_type: 'project_task',
    is_from_itil_standard: false,
    created_by: userId,
  });

  // The tenant's own categories, owned by `Own Work`.
  const ownCategory = { parentId: uuidv4(), childId: uuidv4() };
  await tt(db, tenantId, 'categories').insert([
    {
      tenant: tenantId,
      category_id: ownCategory.parentId,
      category_name: 'Workstations',
      board_id: boards.own,
      parent_category: null,
      created_by: userId,
    },
    {
      tenant: tenantId,
      category_id: ownCategory.childId,
      category_name: 'Docking stations',
      board_id: boards.own,
      parent_category: ownCategory.parentId,
      created_by: userId,
    },
  ]);

  // Every ITIL board owns its own copy of the standard set, each row linked to the standard row it
  // came from (D9). Parents are inserted before their children.
  const standardCategories = await db('standard_categories')
    .where({ is_itil_standard: true })
    .orderByRaw('parent_category_uuid IS NOT NULL')
    .select('id', 'category_name', 'parent_category_uuid', 'display_order');
  if (standardCategories.length === 0) {
    throw new Error('standard_categories holds no ITIL rows: the fixture cannot build an ITIL board');
  }

  const itilCategoryIdsByBoard: Record<string, Record<string, string>> = {};
  for (const boardId of [boards.itilOne, boards.itilTwo]) {
    const byStandardId: Record<string, string> = {};
    itilCategoryIdsByBoard[boardId] = byStandardId;
    for (const row of standardCategories) {
      const categoryId = uuidv4();
      byStandardId[row.id] = categoryId;
      await tt(db, tenantId, 'categories').insert({
        tenant: tenantId,
        category_id: categoryId,
        category_name: row.category_name,
        board_id: boardId,
        parent_category: row.parent_category_uuid
          ? byStandardId[row.parent_category_uuid] ?? null
          : null,
        display_order: row.display_order ?? null,
        standard_category_id: row.id,
        is_from_itil_standard: true,
        created_by: userId,
      });
    }
  }
  const itilCategoryIdsByStandardId = itilCategoryIdsByBoard[boards.itilOne];

  // A category attached to an ITIL board that is not a standard row (R2: it is listed).
  const itilTwoOwnCategoryId = uuidv4();
  await tt(db, tenantId, 'categories').insert({
    tenant: tenantId,
    category_id: itilTwoOwnCategoryId,
    category_name: 'Board-only extra',
    board_id: boards.itilTwo,
    parent_category: null,
    display_order: 900,
    created_by: userId,
  });

  return {
    tenantId,
    userId,
    clientId,
    contactId,
    boards,
    statuses,
    ownPriorityIds,
    itilPriorityIds,
    ownCategory,
    itilCategoryIdsByStandardId,
    itilCategoryIdsByBoard,
    itilTwoOwnCategoryId,
  };
}

export async function cleanupItilSecondBoardFixture(db: Knex, tenantId: string): Promise<void> {
  await tt(db, tenantId, 'inbound_ticket_defaults').del();
  await tt(db, tenantId, 'tickets').del();
  await tt(db, tenantId, 'contacts').del();
  await tt(db, tenantId, 'clients').del();
  await tt(db, tenantId, 'categories').whereNotNull('parent_category').del();
  await tt(db, tenantId, 'categories').del();
  await tt(db, tenantId, 'boards').update({ default_priority_id: null });
  await tt(db, tenantId, 'priorities').del();
  await tt(db, tenantId, 'statuses').del();
  await tt(db, tenantId, 'boards').del();
  await tt(db, tenantId, 'users').del();
  await tenantRows(db).where({ tenant: tenantId }).del();
}
