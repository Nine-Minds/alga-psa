import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { configureItilSlaForBoard } from '@alga-psa/sla';

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
   * Also auto-creates and assigns "ITIL Standard" SLA policy when using ITIL priorities
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

      // Auto-create "ITIL Standard" SLA policy and assign to board
      // This creates industry-standard SLA targets for each ITIL priority level
      const slaResult = await configureItilSlaForBoard(trx, tenant, boardId);
      if (slaResult.created) {
        console.log(`[ItilStandardsService] Auto-created ITIL Standard SLA policy for board ${boardId}`);
      }
    }

    // Copy ITIL categories if category_type is 'itil'
    if (categoryType === 'itil') {
      await this.copyItilCategoriesToTenant(trx, tenant, createdBy, boardId);
    }
  }

  /**
   * Remove ITIL standards from tenant if no boards use them
   * This is called when switching from ITIL to custom
   * Returns information about what was cleaned up
   */
  static async cleanupUnusedItilStandards(trx: Knex.Transaction, tenant: string): Promise<{
    prioritiesDeleted: number;
    categoriesDeleted: number;
    prioritiesSkippedReason?: string;
    categoriesSkippedReason?: string;
  }> {
    const result = {
      prioritiesDeleted: 0,
      categoriesDeleted: 0,
      prioritiesSkippedReason: undefined as string | undefined,
      categoriesSkippedReason: undefined as string | undefined
    };

    // Get count of ITIL priorities for logging
    const itilPrioritiesResult = await trx('priorities')
      .where('tenant', tenant)
      .where('is_from_itil_standard', true)
      .count('* as count')
      .first();
    const itilPrioritiesCount = Number(itilPrioritiesResult?.count || 0);

    console.log(`[ItilStandardsService.cleanup] Found ${itilPrioritiesCount} ITIL priorities for tenant ${tenant}`);

    // Check if any boards still use ITIL priorities
    const itilPriorityBoards = await trx('boards')
      .where('tenant', tenant)
      .where('priority_type', 'itil')
      .count('* as count')
      .first();

    const itilPriorityBoardCount = Number(itilPriorityBoards?.count || 0);
    console.log(`[ItilStandardsService.cleanup] Boards with priority_type='itil': ${itilPriorityBoardCount}`);

    if (itilPriorityBoardCount === 0) {
      // No boards use ITIL priorities - delete unused ones individually
      // Get ITIL priorities that ARE used by tickets
      const usedPriorityIds = await trx('tickets')
        .where('tenant', tenant)
        .whereIn('priority_id', function() {
          this.select('priority_id')
            .from('priorities')
            .where('tenant', tenant)
            .where('is_from_itil_standard', true);
        })
        .distinct('priority_id')
        .pluck('priority_id');

      console.log(`[ItilStandardsService.cleanup] ITIL priorities in use by tickets: ${usedPriorityIds.length} (${usedPriorityIds.join(', ')})`);

      // Delete ITIL priorities that are NOT in use
      const deleteQuery = trx('priorities')
        .where('tenant', tenant)
        .where('is_from_itil_standard', true);

      if (usedPriorityIds.length > 0) {
        deleteQuery.whereNotIn('priority_id', usedPriorityIds);
      }

      const deleted = await deleteQuery.del();
      result.prioritiesDeleted = deleted;

      if (usedPriorityIds.length > 0) {
        result.prioritiesSkippedReason = `${usedPriorityIds.length} priorit${usedPriorityIds.length === 1 ? 'y' : 'ies'} still in use`;
      }

      console.log(`[ItilStandardsService.cleanup] Deleted ${deleted} unused ITIL priorities, kept ${usedPriorityIds.length} in use`);
    } else {
      result.prioritiesSkippedReason = `${itilPriorityBoardCount} board(s) still use ITIL priorities`;
      console.log(`[ItilStandardsService.cleanup] Skipped priority cleanup: ${result.prioritiesSkippedReason}`);
    }

    // Get count of ITIL categories for logging
    const itilCategoriesResult = await trx('categories')
      .where('tenant', tenant)
      .where('is_from_itil_standard', true)
      .count('* as count')
      .first();
    const itilCategoriesCount = Number(itilCategoriesResult?.count || 0);

    console.log(`[ItilStandardsService.cleanup] Found ${itilCategoriesCount} ITIL categories for tenant ${tenant}`);

    // Check if any boards still use ITIL categories
    const itilCategoryBoards = await trx('boards')
      .where('tenant', tenant)
      .where('category_type', 'itil')
      .count('* as count')
      .first();

    const itilCategoryBoardCount = Number(itilCategoryBoards?.count || 0);
    console.log(`[ItilStandardsService.cleanup] Boards with category_type='itil': ${itilCategoryBoardCount}`);

    if (itilCategoryBoardCount === 0) {
      // No boards use ITIL categories - delete unused ones individually
      // Get ITIL categories that ARE used by tickets (as category or subcategory)
      const usedCategoryIds = await trx('tickets')
        .where('tenant', tenant)
        .where(function() {
          this.whereIn('category_id', function() {
            this.select('category_id')
              .from('categories')
              .where('tenant', tenant)
              .where('is_from_itil_standard', true);
          })
          .orWhereIn('subcategory_id', function() {
            this.select('category_id')
              .from('categories')
              .where('tenant', tenant)
              .where('is_from_itil_standard', true);
          });
        })
        .select('category_id', 'subcategory_id');

      // Collect unique category IDs that are in use
      const usedIds = new Set<string>();
      for (const ticket of usedCategoryIds) {
        if (ticket.category_id) usedIds.add(ticket.category_id);
        if (ticket.subcategory_id) usedIds.add(ticket.subcategory_id);
      }
      const usedCategoryIdArray = Array.from(usedIds);

      console.log(`[ItilStandardsService.cleanup] ITIL categories in use by tickets: ${usedCategoryIdArray.length}`);

      // Delete ITIL categories that are NOT in use
      // Note: Must delete subcategories first (children), then parent categories
      // First, get all ITIL categories to understand parent-child relationships
      const allItilCategories = await trx('categories')
        .where('tenant', tenant)
        .where('is_from_itil_standard', true)
        .select('category_id', 'parent_category');

      // Separate into parents (no parent_category) and children (has parent_category)
      const parentIds = allItilCategories
        .filter(c => !c.parent_category)
        .map(c => c.category_id);
      const childIds = allItilCategories
        .filter(c => c.parent_category)
        .map(c => c.category_id);

      // Delete unused children first
      let deletedCount = 0;
      if (childIds.length > 0) {
        const childDeleteQuery = trx('categories')
          .where('tenant', tenant)
          .where('is_from_itil_standard', true)
          .whereNotNull('parent_category')
          .whereIn('category_id', childIds);

        if (usedCategoryIdArray.length > 0) {
          childDeleteQuery.whereNotIn('category_id', usedCategoryIdArray);
        }

        deletedCount += await childDeleteQuery.del();
      }

      // Then delete unused parents
      if (parentIds.length > 0) {
        const parentDeleteQuery = trx('categories')
          .where('tenant', tenant)
          .where('is_from_itil_standard', true)
          .whereNull('parent_category')
          .whereIn('category_id', parentIds);

        if (usedCategoryIdArray.length > 0) {
          parentDeleteQuery.whereNotIn('category_id', usedCategoryIdArray);
        }

        deletedCount += await parentDeleteQuery.del();
      }

      result.categoriesDeleted = deletedCount;

      if (usedCategoryIdArray.length > 0) {
        result.categoriesSkippedReason = `${usedCategoryIdArray.length} categor${usedCategoryIdArray.length === 1 ? 'y' : 'ies'} still in use`;
      }

      console.log(`[ItilStandardsService.cleanup] Deleted ${deletedCount} unused ITIL categories, kept ${usedCategoryIdArray.length} in use`);
    } else {
      result.categoriesSkippedReason = `${itilCategoryBoardCount} board(s) still use ITIL categories`;
      console.log(`[ItilStandardsService.cleanup] Skipped category cleanup: ${result.categoriesSkippedReason}`);
    }

    return result;
  }
}