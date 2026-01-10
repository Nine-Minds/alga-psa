import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

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

    console.log(`[ItilStandardsService] Found ${itilPriorities.length} ITIL priorities in standard_priorities for tenant ${tenant}`);

    if (itilPriorities.length === 0) {
      console.warn('[ItilStandardsService] No ITIL priorities found in standard_priorities table. ITIL configuration may be incomplete.');
      return;
    }

    for (const stdPriority of itilPriorities) {
      // Check if already exists in tenant priorities
      const existing = await trx('priorities')
        .where('tenant', tenant)
        .where('priority_name', stdPriority.priority_name)
        .where('item_type', stdPriority.item_type)
        .first();

      if (!existing) {
        const newPriorityId = uuidv4();
        console.log(`[ItilStandardsService] Inserting ITIL priority "${stdPriority.priority_name}" (${newPriorityId}) for tenant ${tenant}`);
        await trx('priorities').insert({
          priority_id: newPriorityId,
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
        console.log(`[ItilStandardsService] Updating existing priority "${stdPriority.priority_name}" to mark as ITIL for tenant ${tenant}`);
        await trx('priorities')
          .where('priority_id', existing.priority_id)
          .andWhere('tenant', tenant)
          .update({
            is_from_itil_standard: true,
            itil_priority_level: stdPriority.itil_priority_level,
            updated_at: trx.fn.now()
          });
      } else {
        console.log(`[ItilStandardsService] ITIL priority "${stdPriority.priority_name}" already exists for tenant ${tenant}`);
      }
    }

    console.log(`[ItilStandardsService] Completed copying ITIL priorities for tenant ${tenant}`);
  }

  /**
   * Copy ITIL standard categories to tenant's categories table
   */
  static async copyItilCategoriesToTenant(trx: Knex.Transaction, tenant: string, createdBy: string, boardId?: string): Promise<void> {
    // Get ITIL standard categories from reference table
    const itilCategories = await trx('standard_categories')
      .where('is_itil_standard', true)
      .select('*')
      .orderBy('parent_category_uuid', 'asc'); // Parents first

    console.log(`[ItilStandardsService] Found ${itilCategories.length} ITIL categories in standard_categories for tenant ${tenant}`);

    if (itilCategories.length === 0) {
      console.warn('[ItilStandardsService] No ITIL categories found in standard_categories table.');
      return;
    }

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
        const newCategoryId = uuidv4();
        console.log(`[ItilStandardsService] Inserting ITIL category "${stdCategory.category_name}" (${newCategoryId}) for tenant ${tenant}`);
        await trx('categories').insert({
          category_id: newCategoryId,
          tenant: tenant,
          category_name: stdCategory.category_name,
          parent_category: null,
          board_id: boardId,
          is_from_itil_standard: true,
          created_by: createdBy,
          created_at: trx.fn.now()
        });

        idMap[stdCategory.id] = newCategoryId;
      } else {
        idMap[stdCategory.id] = existing.category_id;

        // Update to mark as ITIL if not already marked
        if (!existing.is_from_itil_standard) {
          console.log(`[ItilStandardsService] Updating existing category "${stdCategory.category_name}" to mark as ITIL for tenant ${tenant}`);
          await trx('categories')
            .where('category_id', existing.category_id)
            .andWhere('tenant', tenant)
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
        console.warn(`[ItilStandardsService] Could not find parent mapping for subcategory ${stdCategory.category_name}`);
        continue;
      }

      // Check if already exists in tenant categories
      const existing = await trx('categories')
        .where('tenant', tenant)
        .where('category_name', stdCategory.category_name)
        .where('parent_category', parentId)
        .first();

      if (!existing) {
        const newSubcategoryId = uuidv4();
        console.log(`[ItilStandardsService] Inserting ITIL subcategory "${stdCategory.category_name}" (${newSubcategoryId}) for tenant ${tenant}`);
        await trx('categories').insert({
          category_id: newSubcategoryId,
          tenant: tenant,
          category_name: stdCategory.category_name,
          parent_category: parentId,
          board_id: boardId,
          is_from_itil_standard: true,
          created_by: createdBy,
          created_at: trx.fn.now()
        });
      } else if (!existing.is_from_itil_standard) {
        // Update to mark as ITIL if not already marked
        console.log(`[ItilStandardsService] Updating existing subcategory "${stdCategory.category_name}" to mark as ITIL for tenant ${tenant}`);
        await trx('categories')
          .where('category_id', existing.category_id)
          .andWhere('tenant', tenant)
          .update({
            is_from_itil_standard: true
          });
      }
    }

    console.log(`[ItilStandardsService] Completed copying ITIL categories for tenant ${tenant}`);
  }

  /**
   * Handle ITIL configuration for a board
   * Copies necessary ITIL standards to tenant tables when ITIL is enabled
   */
  static async handleItilConfiguration(
    trx: Knex.Transaction,
    tenant: string,
    createdBy: string,
    boardId: string,
    categoryType?: 'custom' | 'itil',
    priorityType?: 'custom' | 'itil'
  ): Promise<void> {
    // Copy ITIL priorities if priority_type is 'itil'
    if (priorityType === 'itil') {
      await this.copyItilPrioritiesToTenant(trx, tenant, createdBy);
    }

    // Copy ITIL categories if category_type is 'itil'
    if (categoryType === 'itil') {
      await this.copyItilCategoriesToTenant(trx, tenant, createdBy, boardId);
    }
  }

  /**
   * Remove ITIL standards from tenant if no boards use them
   * This is called when switching from ITIL to custom
   */
  static async cleanupUnusedItilStandards(trx: Knex.Transaction, tenant: string): Promise<void> {
    // Check if any boards still use ITIL priorities
    const itilPriorityBoards = await trx('boards')
      .where('tenant', tenant)
      .where('priority_type', 'itil')
      .count('* as count')
      .first();

    if (!itilPriorityBoards || itilPriorityBoards.count === 0) {
      // No boards use ITIL priorities, but don't delete them if they're in use by tickets
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

    // Check if any boards still use ITIL categories
    const itilCategoryBoards = await trx('boards')
      .where('tenant', tenant)
      .where('category_type', 'itil')
      .count('* as count')
      .first();

    if (!itilCategoryBoards || itilCategoryBoards.count === 0) {
      // No boards use ITIL categories, but don't delete them if they're in use by tickets
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