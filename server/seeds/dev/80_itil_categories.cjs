/**
 * Development seed to create test ITIL categories for tenant
 * This is for development/testing only - actual ITIL standards come from migrations
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.seed = async function(knex) {
  const tenant = await knex('tenants').first();
  if (!tenant) {
    console.log('No tenant found, skipping ITIL categories seed');
    return;
  }

  // Check if we already have ITIL categories for this tenant
  const existingItilCategories = await knex('categories')
    .where('tenant', tenant.tenant)
    .where('is_from_itil_standard', true)
    .select('*');

  if (existingItilCategories.length > 0) {
    console.log('ITIL categories already exist for tenant, skipping...');
    return;
  }

  // Copy ITIL categories from standard_categories to tenant's categories table
  // This simulates what should happen automatically when an ITIL board is created
  const itilStandardCategories = await knex('standard_categories')
    .where('is_itil_standard', true)
    .select('*');

  // Create a mapping of old parent IDs to new tenant-specific IDs
  const parentIdMap = {};

  // First, insert parent categories (those with no parent)
  const parentCategories = itilStandardCategories.filter(cat => !cat.parent_category_uuid);

  for (const stdCategory of parentCategories) {
    const newId = knex.raw('gen_random_uuid()');

    // Check if already exists in tenant categories
    const existing = await knex('categories')
      .where('tenant', tenant.tenant)
      .where('category_name', stdCategory.category_name)
      .whereNull('parent_category_uuid')
      .first();

    if (!existing) {
      await knex('categories').insert({
        category_id: newId,
        tenant: tenant.tenant,
        category_name: stdCategory.category_name,
        parent_category_uuid: null,
        description: stdCategory.description,
        display_order: stdCategory.display_order,
        is_from_itil_standard: true,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      });

      // Get the inserted ID for mapping
      const inserted = await knex('categories')
        .where('tenant', tenant.tenant)
        .where('category_name', stdCategory.category_name)
        .whereNull('parent_category_uuid')
        .first();

      parentIdMap[stdCategory.id] = inserted.category_id;
    } else {
      parentIdMap[stdCategory.id] = existing.category_id;
    }
  }

  // Then, insert subcategories with mapped parent IDs
  const subCategories = itilStandardCategories.filter(cat => cat.parent_category_uuid);

  for (const stdCategory of subCategories) {
    const parentId = parentIdMap[stdCategory.parent_category_uuid];

    if (!parentId) {
      console.log(`Warning: Could not find parent for subcategory ${stdCategory.category_name}`);
      continue;
    }

    // Check if already exists in tenant categories
    const existing = await knex('categories')
      .where('tenant', tenant.tenant)
      .where('category_name', stdCategory.category_name)
      .where('parent_category_uuid', parentId)
      .first();

    if (!existing) {
      await knex('categories').insert({
        category_id: knex.raw('gen_random_uuid()'),
        tenant: tenant.tenant,
        category_name: stdCategory.category_name,
        parent_category_uuid: parentId,
        description: stdCategory.description,
        display_order: stdCategory.display_order,
        is_from_itil_standard: true,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      });
    }
  }

  console.log('Copied ITIL categories to tenant for testing');
};