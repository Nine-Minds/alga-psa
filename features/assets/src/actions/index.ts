/**
 * Asset server actions
 *
 * These are Next.js server actions for asset operations.
 * They handle validation, authorization, and delegate to the repository.
 */

'use server';

import { createAssetRepository } from '../repositories/index.js';
import {
  createAssetSchema,
  updateAssetSchema,
  createAssetRelationshipSchema,
  createMaintenanceScheduleSchema,
  updateMaintenanceScheduleSchema,
  recordMaintenanceSchema,
  type Asset,
  type AssetFilters,
  type AssetListResponse,
  type CreateAssetInput,
  type UpdateAssetInput,
  type AssetRelationship,
  type CreateAssetRelationshipInput,
  type AssetHistory,
  type AssetMaintenanceSchedule,
  type AssetMaintenanceHistory,
  type CreateMaintenanceScheduleInput,
  type UpdateMaintenanceScheduleInput,
  type RecordMaintenanceInput,
} from '../types/index.js';

// Note: In the real implementation, these would import from @alga-psa/database
// For now, we define the types that will be injected
type Knex = import('knex').Knex;

/**
 * Server action context provided by the app shell
 */
interface ActionContext {
  tenantId: string;
  userId: string;
  knex: Knex;
}

/**
 * Get a list of assets for the current tenant
 */
export async function getAssets(
  context: ActionContext,
  filters: AssetFilters = {}
): Promise<AssetListResponse> {
  const repo = createAssetRepository(context.knex);
  return repo.findMany(context.tenantId, filters);
}

/**
 * Get a single asset by ID
 */
export async function getAsset(
  context: ActionContext,
  assetId: string
): Promise<Asset | null> {
  const repo = createAssetRepository(context.knex);
  return repo.findById(context.tenantId, assetId);
}

/**
 * Create a new asset
 */
export async function createAsset(
  context: ActionContext,
  input: CreateAssetInput
): Promise<{ success: true; asset: Asset } | { success: false; error: string }> {
  // Validate input
  const validation = createAssetSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createAssetRepository(context.knex);
    const asset = await repo.create(context.tenantId, context.userId, validation.data);
    return { success: true, asset };
  } catch (error) {
    console.error('[assets/actions] Failed to create asset:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create asset',
    };
  }
}

/**
 * Update an existing asset
 */
export async function updateAsset(
  context: ActionContext,
  assetId: string,
  input: UpdateAssetInput
): Promise<{ success: true; asset: Asset } | { success: false; error: string }> {
  // Validate input
  const validation = updateAssetSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createAssetRepository(context.knex);
    const asset = await repo.update(context.tenantId, context.userId, assetId, validation.data);

    if (!asset) {
      return { success: false, error: 'Asset not found' };
    }

    return { success: true, asset };
  } catch (error) {
    console.error('[assets/actions] Failed to update asset:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update asset',
    };
  }
}

/**
 * Delete an asset
 */
export async function deleteAsset(
  context: ActionContext,
  assetId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const repo = createAssetRepository(context.knex);
    const deleted = await repo.delete(context.tenantId, assetId);

    if (!deleted) {
      return { success: false, error: 'Asset not found' };
    }

    return { success: true };
  } catch (error) {
    console.error('[assets/actions] Failed to delete asset:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete asset',
    };
  }
}

/**
 * Link two assets together (create relationship)
 */
export async function linkAssets(
  context: ActionContext,
  input: CreateAssetRelationshipInput
): Promise<{ success: true; relationship: AssetRelationship } | { success: false; error: string }> {
  // Validate input
  const validation = createAssetRelationshipSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createAssetRepository(context.knex);
    const relationship = await repo.linkAssets(context.tenantId, validation.data);
    return { success: true, relationship };
  } catch (error) {
    console.error('[assets/actions] Failed to link assets:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to link assets',
    };
  }
}

/**
 * Get asset history
 */
export async function getAssetHistory(
  context: ActionContext,
  assetId: string
): Promise<AssetHistory[]> {
  const repo = createAssetRepository(context.knex);
  return repo.getHistory(context.tenantId, assetId);
}

/**
 * Get related assets
 */
export async function getRelatedAssets(
  context: ActionContext,
  assetId: string
): Promise<AssetRelationship[]> {
  const repo = createAssetRepository(context.knex);
  return repo.getRelatedAssets(context.tenantId, assetId);
}

/**
 * Create maintenance schedule
 */
export async function createMaintenanceSchedule(
  context: ActionContext,
  input: CreateMaintenanceScheduleInput
): Promise<{ success: true; schedule: AssetMaintenanceSchedule } | { success: false; error: string }> {
  // Validate input
  const validation = createMaintenanceScheduleSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const now = new Date().toISOString();
    const [schedule] = await context.knex('asset_maintenance_schedules')
      .insert({
        tenant: context.tenantId,
        ...validation.data,
        is_active: true,
        created_by: context.userId,
        created_at: now,
        updated_at: now,
      })
      .returning('*');

    return { success: true, schedule };
  } catch (error) {
    console.error('[assets/actions] Failed to create maintenance schedule:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create maintenance schedule',
    };
  }
}

/**
 * Update maintenance schedule
 */
export async function updateMaintenanceSchedule(
  context: ActionContext,
  scheduleId: string,
  input: UpdateMaintenanceScheduleInput
): Promise<{ success: true; schedule: AssetMaintenanceSchedule } | { success: false; error: string }> {
  // Validate input
  const validation = updateMaintenanceScheduleSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const [schedule] = await context.knex('asset_maintenance_schedules')
      .where({ tenant: context.tenantId, schedule_id: scheduleId })
      .update({
        ...validation.data,
        updated_at: context.knex.fn.now(),
      })
      .returning('*');

    if (!schedule) {
      return { success: false, error: 'Maintenance schedule not found' };
    }

    return { success: true, schedule };
  } catch (error) {
    console.error('[assets/actions] Failed to update maintenance schedule:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update maintenance schedule',
    };
  }
}

/**
 * Record maintenance history
 */
export async function recordMaintenance(
  context: ActionContext,
  input: RecordMaintenanceInput
): Promise<{ success: true; history: AssetMaintenanceHistory } | { success: false; error: string }> {
  // Validate input
  const validation = recordMaintenanceSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const now = new Date().toISOString();
    const [history] = await context.knex('asset_maintenance_history')
      .insert({
        tenant: context.tenantId,
        ...validation.data,
        performed_by: context.userId,
        created_at: now,
      })
      .returning('*');

    // Update the schedule's last maintenance date
    await context.knex('asset_maintenance_schedules')
      .where({ tenant: context.tenantId, schedule_id: validation.data.schedule_id })
      .update({
        last_maintenance: validation.data.performed_at,
        updated_at: context.knex.fn.now(),
      });

    return { success: true, history };
  } catch (error) {
    console.error('[assets/actions] Failed to record maintenance:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to record maintenance',
    };
  }
}
