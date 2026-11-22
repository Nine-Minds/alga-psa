import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { resolveProductCode } from '@alga-psa/types';

// ITIL SLA configuration is injected by the composition layer to avoid tickets→sla cross-package violation
let _configureItilSlaForBoardFn: ((trx: Knex.Transaction, tenant: string, boardId: string) => Promise<{ created: boolean }>) | null = null;

export function registerItilSlaConfiguration(fn: (trx: Knex.Transaction, tenant: string, boardId: string) => Promise<{ created: boolean }>): void {
  _configureItilSlaForBoardFn = fn;
}

// Name of the SLA policy auto-created by configureItilSlaForBoard (@alga-psa/sla).
const ITIL_SLA_POLICY_NAME = 'ITIL Standard';

/**
 * Service to manage copying ITIL standards to tenant-specific tables
 */
export class ItilStandardsService {
  /**
   * Copy ITIL standard priorities to the tenant's priorities table.
   *
   * An existing row is recognised by its family and `itil_priority_level`, never by its name: a
   * tenant's own priority that happens to be called like an ITIL one is the tenant's, and flagging
   * it would silently move it between the two families. Such a name is a collision against
   * `UNIQUE (tenant, priority_name, item_type)`, so it is reported with the priority's name instead
   * of being worked around.
   */
  static async copyItilPrioritiesToTenant(trx: Knex.Transaction, tenant: string, createdBy: string): Promise<void> {
    const db = tenantDb(trx, tenant);

    // Get ITIL standard priorities from reference table
    const itilPriorities = await db.table('standard_priorities')
      .where('is_itil_standard', true)
      .select('*');

    console.log(`[ItilStandardsService] Found ${itilPriorities.length} ITIL priorities in standard_priorities for tenant ${tenant}`);

    if (itilPriorities.length === 0) {
      console.warn('[ItilStandardsService] No ITIL priorities found in standard_priorities table. ITIL configuration may be incomplete.');
      return;
    }

    for (const stdPriority of itilPriorities) {
      const existing = await db.table('priorities')
        .where('is_from_itil_standard', true)
        .where('item_type', stdPriority.item_type)
        .where('itil_priority_level', stdPriority.itil_priority_level)
        .first();

      if (existing) {
        console.log(`[ItilStandardsService] ITIL priority level ${stdPriority.itil_priority_level} already exists for tenant ${tenant}`);
        continue;
      }

      const nameCollision = await db.table('priorities')
        .where('priority_name', stdPriority.priority_name)
        .where('item_type', stdPriority.item_type)
        .first('priority_id', 'priority_name');

      if (nameCollision) {
        throw new Error(
          `Cannot add the ITIL priority ‘${stdPriority.priority_name}’: a priority of this tenant already uses that name. Rename ‘${nameCollision.priority_name}’ and try again.`
        );
      }

      const newPriorityId = uuidv4();
      console.log(`[ItilStandardsService] Inserting ITIL priority "${stdPriority.priority_name}" (${newPriorityId}) for tenant ${tenant}`);
      await db.table('priorities').insert({
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
    }

    console.log(`[ItilStandardsService] Completed copying ITIL priorities for tenant ${tenant}`);
  }

  /**
   * Give one board its own copy of the standard ITIL category set (D9).
   *
   * A row is recognised by `standard_category_id` — the standard row it was copied from — and only
   * among the categories of this board. Nothing outside the board is read or changed, so a second
   * ITIL board gets its own full set and a tenant's own category that happens to carry a standard
   * name keeps its board, its children and its flag. Parents are inserted before their children so
   * a child always has the board's own parent.
   */
  static async copyItilCategoriesToTenant(trx: Knex.Transaction, tenant: string, createdBy: string, boardId?: string): Promise<void> {
    const db = tenantDb(trx, tenant);

    if (!boardId) {
      console.warn('[ItilStandardsService] No board given; ITIL categories are owned by a board and cannot be seeded tenant-wide.');
      return;
    }

    // Get ITIL standard categories from reference table
    const itilCategories = await db.table('standard_categories')
      .where('is_itil_standard', true)
      .select('*');

    console.log(`[ItilStandardsService] Found ${itilCategories.length} ITIL categories in standard_categories for tenant ${tenant}`);

    if (itilCategories.length === 0) {
      console.warn('[ItilStandardsService] No ITIL categories found in standard_categories table.');
      return;
    }

    // What this board already owns, keyed by the standard row it came from.
    const ownRows: Array<{ category_id: string; standard_category_id: string | null }> = await db.table('categories')
      .where({ board_id: boardId })
      .whereNotNull('standard_category_id')
      .select('category_id', 'standard_category_id');
    const byStandardId = new Map<string, string>(
      ownRows.map(row => [row.standard_category_id as string, row.category_id])
    );

    const insertCopy = async (stdCategory: { id: string; category_name: string; display_order?: number | null }, parentId: string | null) => {
      const newCategoryId = uuidv4();
      await db.table('categories').insert({
        category_id: newCategoryId,
        tenant: tenant,
        category_name: stdCategory.category_name,
        parent_category: parentId,
        board_id: boardId,
        standard_category_id: stdCategory.id,
        is_from_itil_standard: true,
        display_order: stdCategory.display_order ?? 0,
        created_by: createdBy,
        created_at: trx.fn.now()
      });
      byStandardId.set(stdCategory.id, newCategoryId);
    };

    // First pass: the board's own parents.
    for (const stdCategory of itilCategories.filter(category => !category.parent_category_uuid)) {
      if (byStandardId.has(stdCategory.id)) continue;
      console.log(`[ItilStandardsService] Inserting ITIL category "${stdCategory.category_name}" on board ${boardId} for tenant ${tenant}`);
      await insertCopy(stdCategory, null);
    }

    // Second pass: children, under this board's copy of their parent.
    for (const stdCategory of itilCategories.filter(category => category.parent_category_uuid)) {
      const parentId = byStandardId.get(stdCategory.parent_category_uuid);

      if (!parentId) {
        console.warn(`[ItilStandardsService] Could not find parent mapping for subcategory ${stdCategory.category_name}`);
        continue;
      }

      if (byStandardId.has(stdCategory.id)) continue;
      console.log(`[ItilStandardsService] Inserting ITIL subcategory "${stdCategory.category_name}" on board ${boardId} for tenant ${tenant}`);
      await insertCopy(stdCategory, parentId);
    }

    console.log(`[ItilStandardsService] Completed copying ITIL categories for board ${boardId}, tenant ${tenant}`);
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

      // SLA is a PSA-only capability. AlgaDesk tenants may use ITIL priorities for
      // ticket prioritization, but must NOT get an SLA policy auto-created — doing so
      // would generate SLA warning/breach notifications that AlgaDesk does not support.
      const tenantRow = await tenantDb(trx, tenant).table('tenants').first('product_code');
      const { productCode } = resolveProductCode(tenantRow?.product_code);

      if (productCode === 'algadesk') {
        console.log(`[ItilStandardsService] Skipping ITIL Standard SLA auto-config for AlgaDesk tenant ${tenant}`);
      } else if (_configureItilSlaForBoardFn) {
        // Auto-create "ITIL Standard" SLA policy and assign to board
        // This creates industry-standard SLA targets for each ITIL priority level
        const slaResult = await _configureItilSlaForBoardFn(trx, tenant, boardId);
        if (slaResult.created) {
          console.log(`[ItilStandardsService] Auto-created ITIL Standard SLA policy for board ${boardId}`);
        }
      }
    }

    // Copy ITIL categories if category_type is 'itil'
    if (categoryType === 'itil') {
      await this.copyItilCategoriesToTenant(trx, tenant, createdBy, boardId);
    }
  }

  /**
   * Remove ITIL standards from tenant if no boards use them
   * This is called when switching from ITIL to custom, and when the last ITIL
   * board is deleted — in that case the board row still exists (the delete runs
   * after this cleanup), so it is passed in `excludeBoardIds` and ignored.
   *
   * Priorities only: they are tenant-wide, so retiring them needs a tenant-wide sweep. Categories
   * belong to a board (D9) and go with it in `deleteBoard`.
   */
  static async cleanupUnusedItilStandards(trx: Knex.Transaction, tenant: string, excludeBoardIds: string[] = []): Promise<{
    prioritiesDeleted: number;
    prioritiesSkippedReason?: string;
  }> {
    const db = tenantDb(trx, tenant);
    const result = {
      prioritiesDeleted: 0,
      prioritiesSkippedReason: undefined as string | undefined
    };

    // Get count of ITIL priorities for logging
    const itilPrioritiesResult = await db.table('priorities')
      .where('is_from_itil_standard', true)
      .count('* as count')
      .first();
    const itilPrioritiesCount = Number(itilPrioritiesResult?.count || 0);

    console.log(`[ItilStandardsService.cleanup] Found ${itilPrioritiesCount} ITIL priorities for tenant ${tenant}`);

    // Check if any boards still use ITIL priorities
    const itilPriorityBoardsQuery = db.table('boards')
      .where('priority_type', 'itil')
      .count('* as count');
    if (excludeBoardIds.length > 0) {
      itilPriorityBoardsQuery.whereNotIn('board_id', excludeBoardIds);
    }
    const itilPriorityBoards = await itilPriorityBoardsQuery.first();

    const itilPriorityBoardCount = Number(itilPriorityBoards?.count || 0);
    console.log(`[ItilStandardsService.cleanup] Boards with priority_type='itil': ${itilPriorityBoardCount}`);

    if (itilPriorityBoardCount === 0) {
      // No boards use ITIL priorities - delete unused ones individually
      // Get ITIL priorities that ARE used by tickets
      const itilPriorityIds: string[] = await db.table('priorities')
        .where('is_from_itil_standard', true)
        .pluck('priority_id');
      const usedPriorityIds: string[] = itilPriorityIds.length > 0
        ? await db.table('tickets')
          .whereIn('priority_id', itilPriorityIds)
          .distinct('priority_id')
          .pluck('priority_id')
        : [];

      console.log(`[ItilStandardsService.cleanup] ITIL priorities in use by tickets: ${usedPriorityIds.length} (${usedPriorityIds.join(', ')})`);

      // Delete ITIL priorities that are NOT in use, after releasing the rows
      // that reference them (SLA targets and board defaults have hard FKs).
      const usedPriorityIdSet = new Set(usedPriorityIds);
      const deletablePriorityIds = itilPriorityIds.filter(id => !usedPriorityIdSet.has(id));

      let deleted = 0;
      if (deletablePriorityIds.length > 0) {
        await this.releaseItilPriorityReferences(trx, tenant, deletablePriorityIds);

        deleted = await db.table('priorities')
          .whereIn('priority_id', deletablePriorityIds)
          .del();
      }
      result.prioritiesDeleted = deleted;

      if (usedPriorityIds.length > 0) {
        result.prioritiesSkippedReason = `${usedPriorityIds.length} priorit${usedPriorityIds.length === 1 ? 'y' : 'ies'} still in use`;
      }

      console.log(`[ItilStandardsService.cleanup] Deleted ${deleted} unused ITIL priorities, kept ${usedPriorityIds.length} in use`);
    } else {
      result.prioritiesSkippedReason = `${itilPriorityBoardCount} board(s) still use ITIL priorities`;
      console.log(`[ItilStandardsService.cleanup] Skipped priority cleanup: ${result.prioritiesSkippedReason}`);
    }

    return result;
  }

  /**
   * Drop the rows that point at ITIL priorities about to be deleted.
   * Without this the DELETE trips sla_policy_targets / boards FKs and rolls the
   * whole cleanup (and the board deletion around it) back.
   */
  private static async releaseItilPriorityReferences(
    trx: Knex.Transaction,
    tenant: string,
    priorityIds: string[]
  ): Promise<void> {
    const db = tenantDb(trx, tenant);

    const affectedPolicyIds: string[] = await db.table('sla_policy_targets')
      .whereIn('priority_id', priorityIds)
      .distinct('sla_policy_id')
      .pluck('sla_policy_id');

    const targetsDeleted = await db.table('sla_policy_targets')
      .whereIn('priority_id', priorityIds)
      .del();
    console.log(`[ItilStandardsService.cleanup] Deleted ${targetsDeleted} SLA targets for retiring ITIL priorities`);

    // The auto-created "ITIL Standard" policy is meaningless once it has no
    // targets left; retire it so the tenant isn't left with an empty policy.
    for (const policyId of affectedPolicyIds) {
      const policy = await db.table('sla_policies')
        .where({ sla_policy_id: policyId, policy_name: ITIL_SLA_POLICY_NAME })
        .first();
      if (!policy) continue;

      const remainingTargets = await db.table('sla_policy_targets')
        .where({ sla_policy_id: policyId })
        .count('* as count')
        .first();
      if (Number(remainingTargets?.count || 0) > 0) continue;

      const clientRefs = await db.table('clients')
        .where({ sla_policy_id: policyId })
        .count('* as count')
        .first();
      if (Number(clientRefs?.count || 0) > 0) {
        console.log(`[ItilStandardsService.cleanup] Kept empty ITIL Standard SLA policy ${policyId}: still assigned to client(s)`);
        continue;
      }

      await db.table('boards')
        .where({ sla_policy_id: policyId })
        .update({ sla_policy_id: null });

      // Tickets keep the policy stamped on them at SLA start even after moving
      // off the board or changing priority (tickets_sla_policy_fkey).
      await db.table('tickets')
        .where({ sla_policy_id: policyId })
        .update({ sla_policy_id: null });

      await db.table('sla_notification_thresholds').where({ sla_policy_id: policyId }).del();
      await db.table('sla_policies').where({ sla_policy_id: policyId }).del();
      console.log(`[ItilStandardsService.cleanup] Removed empty ITIL Standard SLA policy ${policyId}`);
    }

    await db.table('boards')
      .whereIn('default_priority_id', priorityIds)
      .update({ default_priority_id: null });

    // No FK here, but a dangling id silently breaks email-created tickets.
    await db.table('inbound_ticket_defaults')
      .whereIn('priority_id', priorityIds)
      .update({ priority_id: null });
  }
}
