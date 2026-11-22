'use strict';

/**
 * Per-board ITIL category sets — `ee/plans/2026-11-21-itil-remediation` (D9, R2).
 *
 * Until now a tenant held ONE copy of the standard ITIL category set, stamped with the board_id of
 * the first board that enabled ITIL and recognised by the `is_from_itil_standard` flag. Every
 * picker that filters categories by board came back empty on any other ITIL board, and the set was
 * reused by matching NAMES across the whole tenant, so a tenant's own "Hardware" on another board
 * became an ITIL row with ITIL children hung under it.
 *
 * After this migration a category belongs to a board, for ITIL boards as for every other kind:
 * each ITIL board owns a copy of the set, each copy carries `standard_category_id` (the link to the
 * `standard_categories` row it came from, never a name), and `is_from_itil_standard` is kept equal
 * to "has a standard link".
 *
 * The order matters, and is the PRD's:
 *   1. add `categories.standard_category_id` and the `itil_category_remap` journal;
 *   2. MAP every flagged category to its standard row by name and parent name — wherever it sits:
 *      on an ITIL board, on a non-ITIL board or with no board at all. This is the only name match
 *      in the plan and it runs before anything is cleared;
 *   3. give every ITIL board its own set: rows already on the board are linked in place and keep
 *      their ids, missing rows are inserted parents first, and a standard child whose parent sits
 *      on another board (or on none) is re-parented to the board's own parent;
 *   4. RE-POINT every reference held by an ITIL board to a mapped category that is not that board's
 *      own — tickets, templates, recurring definitions and their overrides, inbound defaults, saved
 *      views, checklist rules, and the settings that hold a board and a category together;
 *   5. CLEAR the flag wherever there is no standard link (a mapped row that is not on an ITIL
 *      board, and a flagged row whose name is not a standard one). No row is deleted;
 *   6. add the partial unique index on (tenant, board_id, standard_category_id).
 *
 * No ticket's priority, Impact or Urgency is touched (D3), and no category on a non-ITIL board
 * changes board, parent or children.
 *
 * Citus: `transaction: false` (create_distributed_table cannot run inside one). Every statement is
 * tenant-pinned, values are read first and written back as parameters (no column references in an
 * UPDATE), and the new table's primary key and every index lead with `tenant`. No RLS policies.
 *
 * Idempotent: a second run finds every link set, every copy present and every reference already
 * pointing at the board's own copy, so it writes nothing — and therefore no journal row either.
 *
 * `itil_category_remap` is kept afterwards: `(tenant, board_id, old_category_id)` answers "what did
 * this board's X become?" for an id found later in a setting the migration could not see.
 */

const { randomUUID } = require('crypto');
const { tenantDb } = require('./utils/tenantDb.cjs');

const REMAP_TABLE = 'itil_category_remap';
const UNIQUE_INDEX = 'categories_tenant_board_standard_category_unique';

exports.config = { transaction: false };

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('categories')) || !(await knex.schema.hasTable('boards'))) {
    return;
  }

  await addSchema(knex);

  const standard = await loadStandardSet(knex);
  for (const tenant of await listTenants(knex)) {
    await migrateTenant(knex, tenant, standard);
  }

  await addUniqueIndex(knex);
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(REMAP_TABLE))) {
    await dropSchema(knex);
    return;
  }

  const tenants = await knex(REMAP_TABLE).distinct('tenant').pluck('tenant');
  for (const tenant of tenants) {
    await revertTenant(knex, tenant);
  }

  await dropSchema(knex);
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

async function addSchema(knex) {
  if (!(await knex.schema.hasColumn('categories', 'standard_category_id'))) {
    await knex.schema.alterTable('categories', (table) => {
      table.uuid('standard_category_id').nullable();
    });
  }

  if (!(await knex.schema.hasTable(REMAP_TABLE))) {
    await knex.schema.createTable(REMAP_TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('remap_id').notNullable();
      // What the migration did, so down() can undo exactly that:
      //   replace  — a reference on `board_id` moved from old_category_id to new_category_id
      //   insert   — new_category_id was created as `board_id`'s copy of standard_category_id
      //   reparent — old_category_id's parent moved from old_parent_category to new_category_id
      //   unflag   — old_category_id lost is_from_itil_standard
      table.text('kind').notNullable();
      table.uuid('board_id').nullable();
      table.uuid('standard_category_id').nullable();
      table.uuid('old_category_id').nullable();
      table.uuid('new_category_id').nullable();
      table.uuid('old_parent_category').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'remap_id']);
    });
    await knex.raw(`
      ALTER TABLE ${REMAP_TABLE}
      ADD CONSTRAINT itil_category_remap_kind_check
      CHECK (kind IN ('replace', 'insert', 'reparent', 'unflag'))
    `);
    await knex.raw(`
      CREATE INDEX itil_category_remap_lookup_idx
      ON ${REMAP_TABLE} (tenant, board_id, old_category_id)
    `);
  }

  const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
  await ensureTenantDistribution(knex, REMAP_TABLE);
}

async function addUniqueIndex(knex) {
  const { ensureConcurrentIndex } = require('./utils/ensureConcurrentIndex.cjs');
  await ensureConcurrentIndex(
    knex,
    UNIQUE_INDEX,
    `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ${UNIQUE_INDEX}
     ON categories (tenant, board_id, standard_category_id)
     WHERE standard_category_id IS NOT NULL`
  );
}

async function dropSchema(knex) {
  await knex.raw(`DROP INDEX IF EXISTS ${UNIQUE_INDEX}`);
  await knex.schema.dropTableIfExists(REMAP_TABLE);
  if (await knex.schema.hasColumn('categories', 'standard_category_id')) {
    await knex.schema.alterTable('categories', (table) => {
      // migration-lint: allow R3 - down() drops the column this up() added, nothing older
      table.dropColumn('standard_category_id');
    });
  }
}

// ---------------------------------------------------------------------------
// The standard set
// ---------------------------------------------------------------------------

function norm(value) {
  return String(value ?? '').trim().toLowerCase();
}

function copyKey(boardId, standardId) {
  return `${boardId}|${standardId}`;
}

async function loadStandardSet(knex) {
  if (!(await knex.schema.hasTable('standard_categories'))) {
    return { parents: [], children: [], parentByName: new Map(), childByParentAndName: new Map() };
  }
  const rows = await knex('standard_categories')
    .where({ is_itil_standard: true })
    .select('id', 'category_name', 'parent_category_uuid', 'display_order')
    .orderBy('display_order', 'asc')
    .orderBy('category_name', 'asc');

  const parents = rows.filter((row) => !row.parent_category_uuid);
  const children = rows.filter((row) => row.parent_category_uuid);
  const parentByName = new Map(parents.map((row) => [norm(row.category_name), row]));
  const childByParentAndName = new Map(
    children.map((row) => [`${row.parent_category_uuid}|${norm(row.category_name)}`, row])
  );
  return { parents, children, parentByName, childByParentAndName };
}

async function listTenants(knex) {
  const fromBoards = await knex('boards').distinct('tenant').pluck('tenant');
  const fromCategories = await knex('categories').distinct('tenant').pluck('tenant');
  return [...new Set([...fromBoards, ...fromCategories])];
}

// ---------------------------------------------------------------------------
// One tenant
// ---------------------------------------------------------------------------

async function migrateTenant(knex, tenant, standard) {
  const db = tenantDb(knex, tenant);

  const categories = await db
    .table('categories')
    .select(
      'category_id',
      'category_name',
      'board_id',
      'parent_category',
      'is_from_itil_standard',
      'standard_category_id',
      'created_by',
      'created_at'
    )
    .orderBy('created_at', 'asc')
    .orderBy('category_id', 'asc');

  const boards = await db.table('boards').select('board_id', 'category_type');
  const itilBoards = boards.filter((board) => String(board.category_type ?? '') === 'itil');

  if (categories.length === 0 && itilBoards.length === 0) return;

  const byId = new Map(categories.map((row) => [row.category_id, row]));
  const mapped = mapFlaggedCategories(categories, standard);

  // Step 3 — every ITIL board gets its own set.
  const copies = new Map();
  for (const board of itilBoards) {
    await buildBoardSet(knex, db, tenant, board.board_id, categories, byId, mapped, standard, copies);
  }

  // Step 4 — move the references of each ITIL board onto that board's own copies.
  for (const board of itilBoards) {
    const repoint = new Map();
    for (const [categoryId, standardId] of mapped) {
      const copy = copies.get(copyKey(board.board_id, standardId));
      if (!copy || copy === categoryId) continue;
      repoint.set(categoryId, copy);
    }
    if (repoint.size === 0) continue;
    const replaced = await repointBoardReferences(knex, db, board.board_id, repoint);
    for (const oldId of replaced) {
      await journal(db, tenant, {
        kind: 'replace',
        board_id: board.board_id,
        standard_category_id: mapped.get(oldId) ?? null,
        old_category_id: oldId,
        new_category_id: repoint.get(oldId),
      });
    }
  }

  // Step 5 — the flag is "has a standard link", and only a row on an ITIL board keeps a link.
  await reconcileFlags(db, tenant, categories, copies, itilBoards);
}

/**
 * Step 2 — the one name match. A flagged top-level row is matched to a standard parent by name; a
 * flagged child is matched among the standard children of whatever its parent mapped to, so the
 * tenant's own category that the old name match flagged carries its ITIL children with it. A row
 * that already holds a link (a re-run) is taken from the link.
 */
function mapFlaggedCategories(categories, standard) {
  const mapped = new Map();

  for (const row of categories) {
    if (row.standard_category_id) {
      mapped.set(row.category_id, row.standard_category_id);
      continue;
    }
    if (!row.is_from_itil_standard || row.parent_category) continue;
    const match = standard.parentByName.get(norm(row.category_name));
    if (match) mapped.set(row.category_id, match.id);
  }

  for (const row of categories) {
    if (mapped.has(row.category_id)) continue;
    if (!row.is_from_itil_standard || !row.parent_category) continue;
    const parentStandardId = mapped.get(row.parent_category);
    if (!parentStandardId) continue;
    const match = standard.childByParentAndName.get(`${parentStandardId}|${norm(row.category_name)}`);
    if (match) mapped.set(row.category_id, match.id);
  }

  return mapped;
}

async function buildBoardSet(knex, db, tenant, boardId, categories, byId, mapped, standard, copies) {
  // 3a — rows already on the board are linked in place and keep their ids. If two of them map to
  // the same standard row, the older one is the board's copy and the other stays as an ordinary
  // category of the board (the unique index allows one copy per board).
  for (const row of categories) {
    if (row.board_id !== boardId) continue;
    const standardId = mapped.get(row.category_id);
    if (!standardId) continue;
    if (copies.has(copyKey(boardId, standardId))) continue;
    copies.set(copyKey(boardId, standardId), row.category_id);
    if (row.standard_category_id !== standardId || row.is_from_itil_standard !== true) {
      // migration-lint: allow R5 - one row by primary key: the category this board already holds
      await db
        .table('categories')
        .where({ category_id: row.category_id })
        .update({ standard_category_id: standardId, is_from_itil_standard: true });
      row.standard_category_id = standardId;
      row.is_from_itil_standard = true;
    }
  }

  if (standard.parents.length === 0) return;

  const createdBy = resolveCreatedBy(categories, boardId);
  const author = createdBy ?? (await firstUserId(db));
  if (!author) return;

  // 3b — insert what the board is missing, parents first.
  for (const std of standard.parents) {
    if (copies.has(copyKey(boardId, std.id))) continue;
    const categoryId = await insertCopy(knex, db, tenant, boardId, std, null, author);
    copies.set(copyKey(boardId, std.id), categoryId);
    await journal(db, tenant, {
      kind: 'insert',
      board_id: boardId,
      standard_category_id: std.id,
      new_category_id: categoryId,
    });
  }
  for (const std of standard.children) {
    if (copies.has(copyKey(boardId, std.id))) continue;
    const parentId = copies.get(copyKey(boardId, std.parent_category_uuid));
    if (!parentId) continue;
    const categoryId = await insertCopy(knex, db, tenant, boardId, std, parentId, author);
    copies.set(copyKey(boardId, std.id), categoryId);
    await journal(db, tenant, {
      kind: 'insert',
      board_id: boardId,
      standard_category_id: std.id,
      new_category_id: categoryId,
    });
  }

  // 3c — a standard child of this board whose parent sits on another board, or on none, is
  // re-parented to the board's own parent.
  for (const std of standard.children) {
    const categoryId = copies.get(copyKey(boardId, std.id));
    const row = categoryId ? byId.get(categoryId) : null;
    if (!row) continue;
    const parentId = copies.get(copyKey(boardId, std.parent_category_uuid));
    if (!parentId || row.parent_category === parentId) continue;
    await journal(db, tenant, {
      kind: 'reparent',
      board_id: boardId,
      standard_category_id: std.id,
      old_category_id: categoryId,
      new_category_id: parentId,
      old_parent_category: row.parent_category,
    });
    // migration-lint: allow R5 - one row by primary key: this board's copy of one standard child
    await db.table('categories').where({ category_id: categoryId }).update({ parent_category: parentId });
    row.parent_category = parentId;
  }
}

function resolveCreatedBy(categories, boardId) {
  const onBoard = categories.find((row) => row.board_id === boardId && row.created_by);
  if (onBoard) return onBoard.created_by;
  const anywhere = categories.find((row) => row.created_by);
  return anywhere ? anywhere.created_by : null;
}

async function firstUserId(db) {
  const user = await db.table('users').orderBy('created_at', 'asc').first('user_id');
  return user ? user.user_id : null;
}

async function insertCopy(knex, db, tenant, boardId, std, parentId, author) {
  const categoryId = randomUUID();
  // migration-lint: allow R5 - one row: one standard category missing from one board (35 at most)
  await db.table('categories').insert({
    category_id: categoryId,
    tenant,
    category_name: std.category_name,
    parent_category: parentId,
    board_id: boardId,
    display_order: std.display_order ?? 0,
    is_from_itil_standard: true,
    standard_category_id: std.id,
    created_by: author,
    created_at: knex.fn.now(),
  });
  return categoryId;
}

/** Step 5. The flag mirrors the link: set where a link was taken, cleared where there is none. */
async function reconcileFlags(db, tenant, categories, copies, itilBoards) {
  const keptLink = new Set(copies.values());
  const itilBoardIds = new Set(itilBoards.map((board) => board.board_id));

  for (const row of categories) {
    const keeps = keptLink.has(row.category_id) && itilBoardIds.has(row.board_id);
    if (keeps) continue;
    if (!row.is_from_itil_standard && !row.standard_category_id) continue;
    await journal(db, tenant, {
      kind: 'unflag',
      board_id: row.board_id ?? null,
      standard_category_id: row.standard_category_id ?? null,
      old_category_id: row.category_id,
    });
    // migration-lint: allow R5 - one row by primary key: one category of one tenant
    await db
      .table('categories')
      .where({ category_id: row.category_id })
      .update({ is_from_itil_standard: false, standard_category_id: null });
    row.is_from_itil_standard = false;
    row.standard_category_id = null;
  }
}

async function journal(db, tenant, row) {
  await db.table(REMAP_TABLE).insert({ tenant, remap_id: randomUUID(), ...row });
}

// ---------------------------------------------------------------------------
// Step 4 — the reference sites
// ---------------------------------------------------------------------------

const COLUMN_SITES = [
  { table: 'tickets', columns: ['category_id', 'subcategory_id'] },
  { table: 'ticket_templates', columns: ['category_id', 'subcategory_id'] },
  { table: 'recurring_ticket_definitions', columns: ['category_id', 'subcategory_id'] },
  { table: 'inbound_ticket_defaults', columns: ['category_id', 'subcategory_id'] },
  { table: 'checklist_template_apply_rules', columns: ['category_id', 'subcategory_id'] },
];

/**
 * Moves every reference this board holds to a category that is not its own onto the board's copy of
 * the same standard category. Returns the set of old ids that something actually pointed at, so the
 * journal carries one row per replaced (board, old id) pair and none for a board that kept its rows.
 */
async function repointBoardReferences(knex, db, boardId, repoint) {
  const replaced = new Set();
  const oldIds = [...repoint.keys()];

  for (const site of COLUMN_SITES) {
    if (!(await knex.schema.hasTable(site.table))) continue;
    for (const column of site.columns) {
      if (!(await knex.schema.hasColumn(site.table, column))) continue;
      const inUse = await db
        .table(site.table)
        .where({ board_id: boardId })
        .whereIn(column, oldIds)
        .distinct(column)
        .pluck(column);
      for (const oldId of inUse) {
        // migration-lint: allow UNRESOLVED - site.table is one of the literal COLUMN_SITES above, and this is one tenant-scoped row by (board_id, category id)
        await db
          .table(site.table)
          .where({ board_id: boardId, [column]: oldId })
          .update({ [column]: repoint.get(oldId) });
        replaced.add(oldId);
      }
    }
  }

  for (const oldId of await repointRecurringOverrides(knex, db, boardId, repoint)) replaced.add(oldId);
  for (const oldId of await repointBoardView(db, boardId, repoint)) replaced.add(oldId);
  for (const oldId of await repointListViews(knex, db, boardId, repoint)) replaced.add(oldId);
  for (const oldId of await repointHuntressSettings(knex, db, boardId, repoint)) replaced.add(oldId);
  for (const oldId of await repointWorkflowDefinitions(knex, db, boardId, repoint)) replaced.add(oldId);
  for (const oldId of await repointInboundWebhooks(knex, db, boardId, repoint)) replaced.add(oldId);

  return replaced;
}

function asObject(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** Rewrites one id. Returns the replacement, or the value unchanged. */
function swap(value, repoint, replaced) {
  if (typeof value !== 'string') return value;
  const next = repoint.get(value);
  if (!next) return value;
  replaced.add(value);
  return next;
}

function swapCategoryKeys(holder, repoint, replaced, keys) {
  let changed = false;
  for (const key of keys) {
    const value = holder[key];
    if (Array.isArray(value)) {
      const next = value.map((entry) => swap(entry, repoint, replaced));
      if (next.some((entry, index) => entry !== value[index])) {
        holder[key] = next;
        changed = true;
      }
      continue;
    }
    const next = swap(value, repoint, replaced);
    if (next !== value) {
      holder[key] = next;
      changed = true;
    }
  }
  return changed;
}

const FILTER_CATEGORY_KEYS = ['categoryId', 'categoryIds', 'excludeCategoryIds'];
const OVERRIDE_CATEGORY_KEYS = ['category_id', 'subcategory_id'];

async function repointRecurringOverrides(knex, db, boardId, repoint) {
  const replaced = new Set();
  if (!(await knex.schema.hasTable('recurring_ticket_definitions'))) return replaced;

  const definitions = await db
    .table('recurring_ticket_definitions')
    .select('definition_id', 'board_id', 'overrides');

  const boardOf = (definitionBoardId, overrides) => {
    const board = asObject(overrides)?.board;
    const overridden = board && typeof board.board_id === 'string' ? board.board_id : null;
    return overridden ?? definitionBoardId;
  };

  for (const definition of definitions) {
    const overrides = asObject(definition.overrides);
    if (!overrides) continue;
    if (boardOf(definition.board_id, overrides) !== boardId) continue;
    const category = asObject(overrides.category);
    if (!category) continue;
    if (!swapCategoryKeys(category, repoint, replaced, OVERRIDE_CATEGORY_KEYS)) continue;
    // migration-lint: allow R5 - one row by primary key: one recurring definition of one tenant
    await db
      .table('recurring_ticket_definitions')
      .where({ definition_id: definition.definition_id })
      .update({ overrides: JSON.stringify(overrides) });
  }

  if (!(await knex.schema.hasTable('recurring_ticket_definition_clients'))) return replaced;

  const definitionBoards = new Map(definitions.map((row) => [row.definition_id, row]));
  const clientRows = await db
    .table('recurring_ticket_definition_clients')
    .select('definition_client_id', 'definition_id', 'overrides');

  for (const row of clientRows) {
    const overrides = asObject(row.overrides);
    if (!overrides) continue;
    const definition = definitionBoards.get(row.definition_id);
    if (!definition) continue;
    const effectiveBoard = boardOf(boardOf(definition.board_id, definition.overrides), overrides);
    if (effectiveBoard !== boardId) continue;
    const category = asObject(overrides.category);
    if (!category) continue;
    if (!swapCategoryKeys(category, repoint, replaced, OVERRIDE_CATEGORY_KEYS)) continue;
    // migration-lint: allow R5 - one row by primary key: one client override of one definition
    await db
      .table('recurring_ticket_definition_clients')
      .where({ definition_client_id: row.definition_client_id })
      .update({ overrides: JSON.stringify(overrides) });
  }

  return replaced;
}

/** The board's own default view: its filters are this board's by definition. */
async function repointBoardView(db, boardId, repoint) {
  const replaced = new Set();
  const board = await db.table('boards').where({ board_id: boardId }).first('list_view_settings');
  const settings = asObject(board?.list_view_settings);
  const filters = asObject(settings?.filters);
  if (!filters) return replaced;
  if (!swapCategoryKeys(filters, repoint, replaced, FILTER_CATEGORY_KEYS)) return replaced;
  // migration-lint: allow R5 - one row by primary key: the board whose own default view this is
  await db
    .table('boards')
    .where({ board_id: boardId })
    .update({ list_view_settings: JSON.stringify(settings) });
  return replaced;
}

/** A personal or shared view is re-pointed only when its filters name this one board. */
async function repointListViews(knex, db, boardId, repoint) {
  const replaced = new Set();
  if (!(await knex.schema.hasTable('list_views'))) return replaced;

  const views = await db.table('list_views').select('view_id', 'settings');
  for (const view of views) {
    const settings = asObject(view.settings);
    const filters = asObject(settings?.filters);
    if (!filters) continue;
    const boardIds = Array.isArray(filters.boardIds) ? filters.boardIds : [];
    const namesThisBoardOnly =
      filters.boardId === boardId
        ? boardIds.length === 0 || (boardIds.length === 1 && boardIds[0] === boardId)
        : boardIds.length === 1 && boardIds[0] === boardId && !filters.boardId;
    if (!namesThisBoardOnly) continue;
    if (!swapCategoryKeys(filters, repoint, replaced, FILTER_CATEGORY_KEYS)) continue;
    // migration-lint: allow R5 - one row by primary key: one saved view of one tenant
    await db
      .table('list_views')
      .where({ view_id: view.view_id })
      .update({ settings: JSON.stringify(settings) });
  }

  return replaced;
}

async function repointHuntressSettings(knex, db, boardId, repoint) {
  const replaced = new Set();
  if (!(await knex.schema.hasTable('rmm_integrations'))) return replaced;

  const rows = await db.table('rmm_integrations').select('integration_id', 'settings');
  for (const row of rows) {
    const settings = asObject(row.settings);
    if (!settings || settings.boardId !== boardId) continue;
    if (!swapCategoryKeys(settings, repoint, replaced, ['categoryId', 'subcategoryId'])) continue;
    // migration-lint: allow R5 - one row by primary key: one integration row of one tenant
    await db
      .table('rmm_integrations')
      .where({ integration_id: row.integration_id })
      .update({ settings: JSON.stringify(settings) });
  }

  return replaced;
}

/** A `tickets.create` step whose board is a fixed id: its category is that board's. */
function repointWorkflowSteps(steps, boardId, repoint, replaced) {
  let changed = false;
  if (!Array.isArray(steps)) return changed;

  for (const step of steps) {
    const node = asObject(step);
    if (!node) continue;
    const config = asObject(node.config);
    if (config) {
      const mapping = asObject(config.inputMapping);
      if (mapping && mapping.board_id === boardId) {
        if (swapCategoryKeys(mapping, repoint, replaced, OVERRIDE_CATEGORY_KEYS)) changed = true;
      }
      for (const key of ['body', 'steps', 'then', 'else', 'try', 'catch', 'finally']) {
        if (repointWorkflowSteps(config[key], boardId, repoint, replaced)) changed = true;
      }
    }
    for (const key of ['then', 'else', 'body', 'try', 'catch', 'finally', 'steps']) {
      if (repointWorkflowSteps(node[key], boardId, repoint, replaced)) changed = true;
    }
  }

  return changed;
}

async function repointWorkflowDefinitions(knex, db, boardId, repoint) {
  const replaced = new Set();

  if (await knex.schema.hasTable('workflow_definitions')) {
    const rows = await db.table('workflow_definitions').select('workflow_id', 'draft_definition');
    for (const row of rows) {
      const definition = asObject(row.draft_definition);
      if (!definition) continue;
      if (!repointWorkflowSteps(definition.steps, boardId, repoint, replaced)) continue;
      // migration-lint: allow R5 - one row by primary key: one workflow draft of one tenant
      await db
        .table('workflow_definitions')
        .where({ workflow_id: row.workflow_id })
        .update({ draft_definition: JSON.stringify(definition) });
    }
  }

  if (await knex.schema.hasTable('workflow_definition_versions')) {
    const rows = await db
      .table('workflow_definition_versions')
      .select('version_id', 'definition_json');
    for (const row of rows) {
      const definition = asObject(row.definition_json);
      if (!definition) continue;
      if (!repointWorkflowSteps(definition.steps, boardId, repoint, replaced)) continue;
      // migration-lint: allow R5 - one row by primary key: one published workflow version
      await db
        .table('workflow_definition_versions')
        .where({ version_id: row.version_id })
        .update({ definition_json: JSON.stringify(definition) });
    }
  }

  return replaced;
}

/**
 * A direct-action webhook stores each field as a JSONata expression; a fixed value is a quoted
 * literal. Only a webhook whose board is such a literal naming this board is re-pointed, and the
 * quoting style of the value it replaces is kept.
 */
function literalValue(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = trimmed.match(/^"((?:[^"\\]|\\.)*)"$/) || trimmed.match(/^'((?:[^'\\]|\\.)*)'$/);
  return match ? { value: match[1], quote: trimmed[0] } : null;
}

async function repointInboundWebhooks(knex, db, boardId, repoint) {
  const replaced = new Set();
  if (!(await knex.schema.hasTable('inbound_webhooks'))) return replaced;

  const rows = await db.table('inbound_webhooks').select('inbound_webhook_id', 'handler_config');
  for (const row of rows) {
    const config = asObject(row.handler_config);
    const mapping = asObject(config?.field_mapping);
    if (!mapping) continue;
    const board = literalValue(mapping.board_id);
    if (!board || board.value !== boardId) continue;

    let changed = false;
    for (const key of OVERRIDE_CATEGORY_KEYS) {
      const literal = literalValue(mapping[key]);
      if (!literal) continue;
      const next = repoint.get(literal.value);
      if (!next) continue;
      mapping[key] = `${literal.quote}${next}${literal.quote}`;
      replaced.add(literal.value);
      changed = true;
    }
    if (!changed) continue;

    // migration-lint: allow R5 - one row by primary key: one webhook of one tenant
    await db
      .table('inbound_webhooks')
      .where({ inbound_webhook_id: row.inbound_webhook_id })
      .update({ handler_config: JSON.stringify(config) });
  }

  return replaced;
}

// ---------------------------------------------------------------------------
// Reversal
// ---------------------------------------------------------------------------

async function revertTenant(knex, tenant) {
  const db = tenantDb(knex, tenant);
  const entries = await db
    .table(REMAP_TABLE)
    .select('kind', 'board_id', 'standard_category_id', 'old_category_id', 'new_category_id', 'old_parent_category')
    .orderBy('created_at', 'desc');

  // References first, so the inserted copies they pointed at can then be removed.
  for (const entry of entries) {
    if (entry.kind !== 'replace') continue;
    const back = new Map([[entry.new_category_id, entry.old_category_id]]);
    await repointBoardReferences(knex, db, entry.board_id, back);
  }

  for (const entry of entries) {
    if (entry.kind !== 'reparent') continue;
    // migration-lint: allow R5 - one row by primary key: one journal entry's category
    await db
      .table('categories')
      .where({ category_id: entry.old_category_id })
      .update({ parent_category: entry.old_parent_category });
  }

  for (const entry of entries) {
    if (entry.kind !== 'unflag') continue;
    // migration-lint: allow R5 - one row by primary key: one journal entry's category
    await db
      .table('categories')
      .where({ category_id: entry.old_category_id })
      .update({ is_from_itil_standard: true });
  }

  // Children before parents: the inserted rows are ordered newest first, which is the order they
  // were inserted in reversed (parents first).
  for (const entry of entries) {
    if (entry.kind !== 'insert') continue;
    // migration-lint: allow R5 - one row by primary key: one copy this migration inserted
    await db.table('categories').where({ category_id: entry.new_category_id }).del();
  }
}
