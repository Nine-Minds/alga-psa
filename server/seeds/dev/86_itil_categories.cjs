/**
 * Development seed: the standard ITIL category set, owned by the ITIL board.
 *
 * Runs AFTER 85_itil_priorities.cjs, which creates the "ITIL Support" board. It used to run before
 * it (as 80_…) and therefore stamped the set onto whatever board came first, which is the shape the
 * per-board migration exists to undo. Each row carries `standard_category_id`, the link to the
 * `standard_categories` row it came from — the product never matches these by name again.
 *
 * Only an ITIL board gets the set. Without one, there is nothing to seed.
 *
 * @param { import("knex").Knex } knex
 */
const { randomUUID } = require('crypto');
const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function seed(knex) {
  const context = await getFirstTenantSeedContext(knex, {
    skipMessage: 'No tenant found, skipping ITIL categories seed',
  });
  if (!context) {
    return;
  }

  const { db, tenantId } = context;

  if (!(await knex.schema.hasColumn('categories', 'parent_category'))) {
    console.warn('No parent_category column on categories, skipping ITIL categories seed');
    return;
  }

  const hasStandardLink = await knex.schema.hasColumn('categories', 'standard_category_id');

  const itilBoards = await db
    .table('boards')
    .where('category_type', 'itil')
    .orderBy('display_order')
    .select('board_id', 'board_name');

  if (itilBoards.length === 0) {
    console.log('No ITIL board found for tenant, skipping ITIL categories seed');
    return;
  }

  const createdByUser = await db.table('users').orderBy('created_at').first();
  if (!createdByUser) {
    console.log('No user found for tenant, skipping ITIL categories seed');
    return;
  }

  const standardCategories = await knex('standard_categories')
    .where('is_itil_standard', true)
    .select('*')
    .orderBy('display_order');

  if (standardCategories.length === 0) {
    console.warn('No ITIL categories in standard_categories, skipping ITIL categories seed');
    return;
  }

  const parents = standardCategories.filter((category) => !category.parent_category_uuid);
  const children = standardCategories.filter((category) => category.parent_category_uuid);

  for (const board of itilBoards) {
    const existing = await db
      .table('categories')
      .where('board_id', board.board_id)
      .where('is_from_itil_standard', true)
      .first();

    if (existing) {
      console.log(`ITIL categories already exist on board "${board.board_name}", skipping...`);
      continue;
    }

    const idByStandardId = {};

    for (const standard of [...parents, ...children]) {
      const categoryId = randomUUID();
      await db.table('categories').insert({
        category_id: categoryId,
        tenant: tenantId,
        category_name: standard.category_name,
        parent_category: standard.parent_category_uuid
          ? idByStandardId[standard.parent_category_uuid] ?? null
          : null,
        board_id: board.board_id,
        display_order: standard.display_order ?? 0,
        is_from_itil_standard: true,
        ...(hasStandardLink ? { standard_category_id: standard.id } : {}),
        created_by: createdByUser.user_id,
        created_at: knex.fn.now(),
      });
      idByStandardId[standard.id] = categoryId;
    }

    console.log(`Seeded ${standardCategories.length} ITIL categories on board "${board.board_name}"`);
  }
};
