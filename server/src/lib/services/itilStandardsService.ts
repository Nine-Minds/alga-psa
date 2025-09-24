import { Knex } from 'knex';

/**
 * Service to manage copying ITIL standards to tenant-specific tables
 */
export class ItilStandardsService {
  /**
   * Copy ITIL standard priorities to tenant's priorities table
   */
  static async copyItilPrioritiesToTenant(trx: Knex.Transaction, tenant: string, createdBy: string): Promise<void> {
    // Get ITIL standard priorities from reference table
    const itilPriorities = await trx('standard_priorities')
      .where('is_itil_standard', true)
      .select('*');

    for (const stdPriority of itilPriorities) {
      // Check if already exists in tenant priorities
      const existing = await trx('priorities')
        .where('tenant', tenant)
        .where('priority_name', stdPriority.priority_name)
        .where('item_type', stdPriority.item_type)
        .first();

      if (!existing) {
        await trx('priorities').insert({
          priority_id: trx.raw('gen_random_uuid()'),
          tenant: tenant,
          priority_name: stdPriority.priority_name,
          color: stdPriority.color,
          order_number: stdPriority.order_number,
          is_from_itil_standard: true,
          itil_priority_level: stdPriority.itil_priority_level,
          item_type: stdPriority.item_type,
          created_by: createdBy,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now()
        });
      } else if (!existing.is_from_itil_standard) {
        // Update existing priority to mark as ITIL if it matches but wasn't marked
        await trx('priorities')
          .where('priority_id', existing.priority_id)
          .update({
            is_from_itil_standard: true,
            itil_priority_level: stdPriority.itil_priority_level,
            updated_at: trx.fn.now()
          });
      }
    }
  }

  /**
   * Copy ITIL standard categories to tenant's categories table
   */
  static async copyItilCategoriesToTenant(trx: Knex.Transaction, tenant: string, createdBy: string, channelId?: string): Promise<void> {
    // Get ITIL standard categories from reference table
    const itilCategories = await trx('standard_categories')
      .where('is_itil_standard', true)
      .select('*')
      .orderBy('parent_category_uuid', 'asc'); // Parents first

    // Create a mapping of standard IDs to tenant IDs
    const idMap: Record<string, string> = {};

    // First pass: Insert parent categories
    const parentCategories = itilCategories.filter(cat => !cat.parent_category_uuid);

    for (const stdCategory of parentCategories) {
      // Check if already exists in tenant categories
      const existing = await trx('categories')
        .where('tenant', tenant)
        .where('category_name', stdCategory.category_name)
        .whereNull('parent_category')
        .first();

      if (!existing) {
        const newId = trx.raw('gen_random_uuid()');
        await trx('categories').insert({
          category_id: newId,
          tenant: tenant,
          category_name: stdCategory.category_name,
          parent_category: null,
          channel_id: channelId,
          is_from_itil_standard: true,
          created_by: createdBy,
          created_at: trx.fn.now()
        });

        // Get the inserted record to map the ID
        const inserted = await trx('categories')
          .where('tenant', tenant)
          .where('category_name', stdCategory.category_name)
          .whereNull('parent_category')
          .first();

        idMap[stdCategory.id] = inserted.category_id;
      } else {
        idMap[stdCategory.id] = existing.category_id;

        // Update to mark as ITIL if not already marked
        if (!existing.is_from_itil_standard) {
          await trx('categories')
            .where('category_id', existing.category_id)
            .update({
              is_from_itil_standard: true
            });
        }
      }
    }

    // Second pass: Insert subcategories with mapped parent IDs
    const subCategories = itilCategories.filter(cat => cat.parent_category_uuid);

    for (const stdCategory of subCategories) {
      const parentId = idMap[stdCategory.parent_category_uuid];

      if (!parentId) {
        console.warn(`Could not find parent mapping for subcategory ${stdCategory.category_name}`);
        continue;
      }

      // Check if already exists in tenant categories
      const existing = await trx('categories')
        .where('tenant', tenant)
        .where('category_name', stdCategory.category_name)
        .where('parent_category', parentId)
        .first();

      if (!existing) {
        await trx('categories').insert({
          category_id: trx.raw('gen_random_uuid()'),
          tenant: tenant,
          category_name: stdCategory.category_name,
          parent_category: parentId,
          channel_id: channelId,
          is_from_itil_standard: true,
          created_by: createdBy,
          created_at: trx.fn.now()
        });
      } else if (!existing.is_from_itil_standard) {
        // Update to mark as ITIL if not already marked
        await trx('categories')
          .where('category_id', existing.category_id)
          .update({
            is_from_itil_standard: true
          });
      }
    }
  }

  /**
   * Handle ITIL configuration for a channel
   * Copies necessary ITIL standards to tenant tables when ITIL is enabled
   */
  static async handleItilConfiguration(
    trx: Knex.Transaction,
    tenant: string,
    createdBy: string,
    channelId: string,
    categoryType?: 'custom' | 'itil',
    priorityType?: 'custom' | 'itil'
  ): Promise<void> {
    // Copy ITIL priorities if priority_type is 'itil'
    if (priorityType === 'itil') {
      await this.copyItilPrioritiesToTenant(trx, tenant, createdBy);
    }

    // Copy ITIL categories if category_type is 'itil'
    if (categoryType === 'itil') {
      await this.copyItilCategoriesToTenant(trx, tenant, createdBy, channelId);
    }
  }

  /**
   * Remove ITIL standards from tenant if no channels use them
   * This is called when switching from ITIL to custom
   */
  static async cleanupUnusedItilStandards(trx: Knex.Transaction, tenant: string): Promise<void> {
    // Check if any channels still use ITIL priorities
    const itilPriorityChannels = await trx('channels')
      .where('tenant', tenant)
      .where('priority_type', 'itil')
      .count('* as count')
      .first();

    if (!itilPriorityChannels || itilPriorityChannels.count === 0) {
      // No channels use ITIL priorities, but don't delete them if they're in use by tickets
      const usedPriorities = await trx('tickets')
        .where('tenant', tenant)
        .whereIn('priority_id', function() {
          this.select('priority_id')
            .from('priorities')
            .where('tenant', tenant)
            .where('is_from_itil_standard', true);
        })
        .count('* as count')
        .first();

      if (!usedPriorities || usedPriorities.count === 0) {
        // Safe to remove unused ITIL priorities
        await trx('priorities')
          .where('tenant', tenant)
          .where('is_from_itil_standard', true)
          .del();
      }
    }

    // Check if any channels still use ITIL categories
    const itilCategoryChannels = await trx('channels')
      .where('tenant', tenant)
      .where('category_type', 'itil')
      .count('* as count')
      .first();

    if (!itilCategoryChannels || itilCategoryChannels.count === 0) {
      // No channels use ITIL categories, but don't delete them if they're in use by tickets
      const usedCategories = await trx('tickets')
        .where('tenant', tenant)
        .whereIn('category_id', function() {
          this.select('category_id')
            .from('categories')
            .where('tenant', tenant)
            .where('is_from_itil_standard', true);
        })
        .count('* as count')
        .first();

      if (!usedCategories || usedCategories.count === 0) {
        // Safe to remove unused ITIL categories
        await trx('categories')
          .where('tenant', tenant)
          .where('is_from_itil_standard', true)
          .del();
      }
    }
  }
}