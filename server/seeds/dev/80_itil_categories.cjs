/**
 * Development seed to create test ITIL categories for tenant
 * This is for development/testing only - actual ITIL standards come from migrations
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
const { randomUUID } = require('crypto');

exports.seed = async function(knex) {
  const tenant = await knex('tenants').first();
  if (!tenant) {
    console.log('No tenant found, skipping ITIL categories seed');
    return;
  }

  const parentColumn = (await knex.schema.hasColumn('categories', 'parent_category_uuid'))
    ? 'parent_category_uuid'
    : (await knex.schema.hasColumn('categories', 'parent_category'))
      ? 'parent_category'
      : null;

  if (!parentColumn) {
    console.warn('No parent category column found on categories table, skipping ITIL categories seed');
    return;
  }

  const hasDescription = await knex.schema.hasColumn('categories', 'description');
  const hasUpdatedAt = await knex.schema.hasColumn('categories', 'updated_at');
  const hasUpdatedBy = await knex.schema.hasColumn('categories', 'updated_by');

  const createdByUser = await knex('users')
    .where('tenant', tenant.tenant)
    .orderBy('created_at', 'asc')
    .first();

  if (!createdByUser) {
    console.log('No users found for tenant, skipping ITIL categories seed');
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

  // Determine which channel/id we should associate the ITIL categories with.
  // Prefer an ITIL specific channel if it already exists, otherwise fall back
  // to the tenant's default channel so we can satisfy the non-null constraint.
  const itilChannel = await knex('channels')
    .where('tenant', tenant.tenant)
    .where('channel_name', 'ITIL Support')
    .first();

  const defaultChannel = itilChannel || await knex('channels')
    .where('tenant', tenant.tenant)
    .orderBy('display_order')
    .first();

  if (!defaultChannel) {
    console.log('No channel found for tenant, skipping ITIL categories seed');
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
    const newId = randomUUID();

    // Check if already exists in tenant categories
    const existing = await knex('categories')
      .where('tenant', tenant.tenant)
      .where('category_name', stdCategory.category_name)
      .modify(qb => {
        if (parentColumn === 'parent_category_uuid') {
          qb.whereNull('parent_category_uuid');
        } else {
          qb.whereNull('parent_category');
        }
      })
      .first();

    if (!existing) {
      const insertData = {
        category_id: newId,
        tenant: tenant.tenant,
        category_name: stdCategory.category_name,
        display_order: stdCategory.display_order,
        is_from_itil_standard: true,
        created_by: createdByUser.user_id,
        created_at: knex.fn.now()
      };

      insertData[parentColumn] = null;

      if (hasDescription) {
        insertData.description = stdCategory.description || null;
      }

      if (hasUpdatedAt) {
        insertData.updated_at = knex.fn.now();
      }

      if (hasUpdatedBy) {
        insertData.updated_by = createdByUser.user_id;
      }

      await knex('categories').insert(insertData);

      parentIdMap[stdCategory.id] = newId;
    } else {
      parentIdMap[stdCategory.id] = existing.category_id;

      if (!existing.is_from_itil_standard) {
        await knex('categories')
          .where('category_id', existing.category_id)
          .update({
            is_from_itil_standard: true
          });
      }
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
      .modify(qb => {
        if (parentColumn === 'parent_category_uuid') {
          qb.where('parent_category_uuid', parentId);
        } else {
          qb.where('parent_category', parentId);
        }
      })
      .first();

    if (!existing) {
      const insertData = {
        category_id: randomUUID(),
        tenant: tenant.tenant,
        category_name: stdCategory.category_name,
        display_order: stdCategory.display_order,
        is_from_itil_standard: true,
        created_by: createdByUser.user_id,
        created_at: knex.fn.now()
      };

      insertData[parentColumn] = parentId;

      if (hasDescription) {
        insertData.description = stdCategory.description || null;
      }

      if (hasUpdatedAt) {
        insertData.updated_at = knex.fn.now();
      }

      if (hasUpdatedBy) {
        insertData.updated_by = createdByUser.user_id;
      }

      await knex('categories').insert(insertData);
    }
  }

  console.log('Copied ITIL categories to tenant for testing');
};
