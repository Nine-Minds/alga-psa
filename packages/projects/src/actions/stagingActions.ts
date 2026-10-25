'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex } from '@alga-psa/db';
import type {
  IProjectStagingLine,
  IStagingContainer,
  IStagingContainerMember,
  IUserWithRoles,
  ProjectMaterialBillingDestination,
} from '@alga-psa/types';
import type { Knex } from 'knex';
import {
  addClientLines,
  adjustReservation,
  countActiveStockClaims,
  createContainer,
  deleteContainer,
  installLines,
  InsufficientStockError,
  listContainers,
  listStaging,
  MaterialValidationError,
  packLines,
  releaseAllProjectClaims,
  releaseLines,
  reopenContainer,
  reserveStagingLines,
  sealContainer,
  stageLines,
  StagingError,
  stockConflictResultFrom,
  swapUnit,
  undoInstall,
  unpackLine,
  updateContainer,
  type ClientStagingItem,
  type InstallLineResult,
  type PackItem,
  type StagingContainerView,
  type StagingLineView,
} from '@alga-psa/inventory/lib';
import type { StockConflictResult } from '@alga-psa/inventory/lib/stockConflict';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { assertProjectReadAllowed } from '../lib/projectReadAuthorization';

/**
 * Project staging actions (alga-2026-0002683 C6, design D12). Thin wrappers over the inventory staging
 * lib, which owns the semantics.
 *
 *  - Read (staging page, boxes): `project:read` + the record-level project read decision.
 *  - Mutate (reserve, stage, pack, install, release, boxes): `project:update` + the record-level decision.
 *  - Listing or picking stock units: additionally `inventory:read`.
 *
 * A project the caller may not read answers like a missing one. Every id the caller passes (line, box)
 * is checked to belong to the project named in the call.
 */

type StagingActionError = ActionMessageError | ActionPermissionError;

const READ_DENIED = 'Permission denied: project read required';
const UPDATE_DENIED = 'Permission denied: project update required';

function stagingActionErrorFrom(error: unknown): StagingActionError | StockConflictResult | null {
  const conflict = stockConflictResultFrom(error);
  if (conflict) return conflict;
  if (error instanceof StagingError || error instanceof MaterialValidationError || error instanceof InsufficientStockError) {
    return actionError(error.message);
  }
  if (error instanceof Error) {
    if (error.message === 'Project not found' || error.message === 'Permission denied: Cannot read project') {
      // Missing and forbidden look the same.
      return actionError('Project not found', 'projects:staging.errors.notFound');
    }
    if (error.message === 'Cannot delete a billed material.') return actionError(error.message);
  }
  return null;
}

async function run<T>(work: () => Promise<T>): Promise<T | StagingActionError | StockConflictResult> {
  try {
    return await work();
  } catch (error) {
    const expected = stagingActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

async function gate(
  user: IUserWithRoles,
  tenant: string,
  projectId: string,
  action: 'read' | 'update',
): Promise<{ db: Knex } | StagingActionError> {
  if (!(await hasPermission(user, 'project', action))) {
    return permissionError(action === 'read' ? READ_DENIED : UPDATE_DENIED, `projects:staging.errors.permission.${action}`);
  }
  const { knex: db } = await createTenantKnex();
  await assertProjectReadAllowed(db, tenant, user, projectId);
  return { db };
}

const isGateError = (value: unknown): value is StagingActionError =>
  typeof value === 'object' && value !== null && !('db' in value);

async function assertLinesInProject(db: Knex, tenant: string, projectId: string, lineIds: readonly string[]): Promise<void> {
  if (!Array.isArray(lineIds) || lineIds.length === 0) throw new StagingError('Choose at least one line', 'invalid_input');
  const rows = await db('project_staging_lines').where({ tenant, project_id: projectId }).whereIn('staging_line_id', lineIds as string[]).select('staging_line_id');
  if (rows.length !== new Set(lineIds).size) throw new StagingError('Staging line not found', 'not_found');
}

async function assertContainerInProject(db: Knex, tenant: string, projectId: string, containerId: string): Promise<void> {
  const row = await db('staging_containers').where({ tenant, project_id: projectId, container_id: containerId }).whereNull('deleted_at').first('container_id');
  if (!row) throw new StagingError('Box not found', 'not_found');
}

const userId = (user: IUserWithRoles): string | null => (user as { user_id?: string }).user_id ?? null;

export interface ProjectStagingState {
  lines: StagingLineView[];
  containers: StagingContainerView[];
  /** Unit pickers and unit labels need inventory:read. */
  canReadInventory: boolean;
  canUpdate: boolean;
}

export const getProjectStaging = withAuth(async (
  user,
  { tenant },
  projectId: string,
): Promise<ProjectStagingState | StagingActionError | StockConflictResult> => run(async () => {
  const g = await gate(user, tenant, projectId, 'read');
  if (isGateError(g)) return g;
  const [lines, containers, canReadInventory, canUpdate] = await Promise.all([
    listStaging(g.db, tenant, projectId),
    listContainers(g.db, tenant, projectId),
    hasPermission(user, 'inventory', 'read'),
    hasPermission(user, 'project', 'update'),
  ]);
  return { lines, containers, canReadInventory, canUpdate };
}));

export interface ReserveProjectStagingInput {
  project_id: string;
  task_id?: string | null;
  service_id: string;
  quantity: number;
  location_id?: string | null;
  unit_ids?: string[] | null;
  rate?: number | null;
  currency_code?: string | null;
  billing_destination?: ProjectMaterialBillingDestination | null;
  billing_schedule_entry_id?: string | null;
}

export const reserveProjectStaging = withAuth(async (
  user,
  { tenant },
  input: ReserveProjectStagingInput,
): Promise<IProjectStagingLine[] | StagingActionError | StockConflictResult> => run(async () => {
  const g = await gate(user, tenant, input.project_id, 'update');
  if (isGateError(g)) return g;
  if (input.unit_ids?.length && !(await hasPermission(user, 'inventory', 'read'))) {
    return permissionError('Permission denied: inventory read required to pick units', 'projects:staging.errors.permission.inventory');
  }
  return reserveStagingLines(g.db, tenant, {
    project_id: input.project_id,
    task_id: input.task_id ?? null,
    service_id: input.service_id,
    quantity: input.quantity,
    location_id: input.location_id ?? null,
    unit_ids: input.unit_ids ?? null,
    rate: input.rate ?? null,
    currency_code: input.currency_code ?? null,
    billing_destination: input.billing_destination ?? null,
    billing_schedule_entry_id: input.billing_schedule_entry_id ?? null,
  }, userId(user));
}));

export const adjustProjectStagingLine = withAuth(async (
  user,
  { tenant },
  projectId: string,
  lineId: string,
  quantity: number,
): Promise<IProjectStagingLine | StagingActionError | StockConflictResult> => run(async () => {
  const g = await gate(user, tenant, projectId, 'update');
  if (isGateError(g)) return g;
  await assertLinesInProject(g.db, tenant, projectId, [lineId]);
  return adjustReservation(g.db, tenant, lineId, quantity, userId(user));
}));

export const swapProjectStagingUnit = withAuth(async (
  user,
  { tenant },
  projectId: string,
  lineId: string,
  unitId: string,
): Promise<IProjectStagingLine | StagingActionError | StockConflictResult> => run(async () => {
  const g = await gate(user, tenant, projectId, 'update');
  if (isGateError(g)) return g;
  if (!(await hasPermission(user, 'inventory', 'read'))) {
    return permissionError('Permission denied: inventory read required to pick units', 'projects:staging.errors.permission.inventory');
  }
  await assertLinesInProject(g.db, tenant, projectId, [lineId]);
  return swapUnit(g.db, tenant, lineId, unitId, userId(user));
}));

export const stageProjectStagingLines = withAuth(async (
  user,
  { tenant },
  projectId: string,
  lineIds: string[],
): Promise<IProjectStagingLine[] | StagingActionError | StockConflictResult> => run(async () => {
  const g = await gate(user, tenant, projectId, 'update');
  if (isGateError(g)) return g;
  await assertLinesInProject(g.db, tenant, projectId, lineIds);
  return stageLines(g.db, tenant, lineIds, userId(user), { projectId });
}));

export const releaseProjectStagingLines = withAuth(async (
  user,
  { tenant },
  projectId: string,
  lineIds: string[],
): Promise<IProjectStagingLine[] | StagingActionError | StockConflictResult> => run(async () => {
  const g = await gate(user, tenant, projectId, 'update');
  if (isGateError(g)) return g;
  await assertLinesInProject(g.db, tenant, projectId, lineIds);
  return releaseLines(g.db, tenant, lineIds, userId(user), { projectId });
}));

/** Install keeps addMaterial's semantics: one line at a time, each its own transaction. */
export const installProjectStagingLines = withAuth(async (
  user,
  { tenant },
  projectId: string,
  lineIds: string[],
  options: { allowReservedOverride?: boolean } = {},
): Promise<InstallLineResult[] | StagingActionError | StockConflictResult> => run(async () => {
  const g = await gate(user, tenant, projectId, 'update');
  if (isGateError(g)) return g;
  // Install creates a billable project_materials row: same gate as the billing material wrapper (addMaterial).
  if (!(await hasPermission(user, 'billing', 'create'))) {
    return permissionError('Permission denied: billing create required', 'projects:staging.errors.permission.billing');
  }
  await assertLinesInProject(g.db, tenant, projectId, lineIds);
  return installLines(g.db, tenant, lineIds, userId(user), { projectId, allowReservedOverride: options.allowReservedOverride === true });
}));

export const undoProjectStagingInstall = withAuth(async (
  user,
  { tenant },
  projectId: string,
  lineId: string,
): Promise<IProjectStagingLine | StagingActionError | StockConflictResult> => run(async () => {
  const g = await gate(user, tenant, projectId, 'update');
  if (isGateError(g)) return g;
  await assertLinesInProject(g.db, tenant, projectId, [lineId]);
  return undoInstall(g.db, tenant, lineId, userId(user), { projectId });
}));

export const addProjectClientItems = withAuth(async (
  user,
  { tenant },
  projectId: string,
  input: { task_id?: string | null; items: ClientStagingItem[] },
): Promise<IProjectStagingLine[] | StagingActionError | StockConflictResult> => run(async () => {
  const g = await gate(user, tenant, projectId, 'update');
  if (isGateError(g)) return g;
  // Linking an asset needs asset:read; the refusal is permission-level and says nothing about the asset.
  if ((input.items ?? []).some((item) => Boolean((item as { asset_id?: string | null }).asset_id))
    && !(await hasPermission(user, 'asset', 'read'))) {
    return permissionError('Permission denied: asset read required', 'projects:staging.errors.permission.asset');
  }
  return addClientLines(g.db, tenant, { project_id: projectId, task_id: input.task_id ?? null, items: input.items }, userId(user));
}));

/** Free stock per location for one product, for the reserve dialog. */
export const getProjectStagingAvailability = withAuth(async (
  user,
  { tenant },
  projectId: string,
  serviceId: string,
): Promise<{ track_stock: boolean; is_serialized: boolean; default_location_id: string | null; locations: Array<{ location_id: string; name: string; on_hand: number; reserved: number; held: number; free: number }> } | StagingActionError | StockConflictResult> => run(async () => {
  const g = await gate(user, tenant, projectId, 'update');
  if (isGateError(g)) return g;
  if (!(await hasPermission(user, 'inventory', 'read'))) {
    return permissionError('Permission denied: inventory read required', 'projects:staging.errors.permission.inventoryStock');
  }
  const settings = await g.db('product_inventory_settings').where({ tenant, service_id: serviceId }).first('track_stock', 'is_serialized', 'default_location_id');
  const rows = await g.db('stock_levels as sl')
    .join('stock_locations as loc', function () {
      this.on('loc.location_id', '=', 'sl.location_id').andOn('loc.tenant', '=', 'sl.tenant');
    })
    .where({ 'sl.tenant': tenant, 'sl.service_id': serviceId })
    .select('sl.location_id', 'loc.name', 'sl.quantity_on_hand', 'sl.reserved_quantity', 'sl.held_quantity')
    .orderBy('loc.name', 'asc');
  return {
    track_stock: Boolean(settings?.track_stock),
    is_serialized: Boolean(settings?.track_stock && settings?.is_serialized),
    default_location_id: settings?.default_location_id ?? null,
    locations: rows.map((r: any) => {
      const onHand = Number(r.quantity_on_hand ?? 0);
      const reserved = Number(r.reserved_quantity ?? 0);
      const held = Number(r.held_quantity ?? 0);
      return { location_id: r.location_id, name: r.name, on_hand: onHand, reserved, held, free: onHand - reserved - held };
    }),
  };
}));

/** In-stock, unclaimed units of a product to pick from (inventory:read). */
export const listProjectStagingUnits = withAuth(async (
  user,
  { tenant },
  projectId: string,
  serviceId: string,
): Promise<Array<{ unit_id: string; serial_number: string; location_id: string | null; location_name: string | null }> | StagingActionError | StockConflictResult> => run(async () => {
  const g = await gate(user, tenant, projectId, 'read');
  if (isGateError(g)) return g;
  if (!(await hasPermission(user, 'inventory', 'read'))) return [];
  return g.db('stock_units as u')
    .leftJoin('stock_locations as loc', function () {
      this.on('loc.location_id', '=', 'u.location_id').andOn('loc.tenant', '=', 'u.tenant');
    })
    .where({ 'u.tenant': tenant, 'u.service_id': serviceId, 'u.status': 'in_stock' })
    .whereNull('u.allocated_so_line_id')
    .whereNull('u.allocated_staging_line_id')
    .select('u.unit_id', 'u.serial_number', 'u.location_id', 'loc.name as location_name')
    .orderByRaw('u.received_at ASC NULLS LAST, u.unit_id ASC')
    .limit(500);
}));

/** Assets of the project's client that can join staging (asset:read). */
export const listProjectClientAssets = withAuth(async (
  user,
  { tenant },
  projectId: string,
  search?: string,
): Promise<Array<{ asset_id: string; asset_tag: string; name: string; serial_number: string | null }> | StagingActionError | StockConflictResult> => run(async () => {
  const g = await gate(user, tenant, projectId, 'update');
  if (isGateError(g)) return g;
  if (!(await hasPermission(user, 'asset', 'read'))) return [];
  const project = await g.db('projects').where({ tenant, project_id: projectId }).first('client_id');
  const q = g.db('assets')
    .where({ tenant, client_id: project.client_id })
    .whereNotExists(function () {
      this.select(1)
        .from('project_staging_lines as l')
        .whereRaw('l.tenant = assets.tenant AND l.asset_id = assets.asset_id')
        .whereIn('l.status', ['received', 'staged']);
    })
    .select('asset_id', 'asset_tag', 'name', 'serial_number')
    .orderBy('name', 'asc')
    .limit(100);
  const term = typeof search === 'string' ? search.trim() : '';
  if (term) {
    q.andWhere((qb) => qb.whereILike('name', `%${term}%`).orWhereILike('asset_tag', `%${term}%`).orWhereILike('serial_number', `%${term}%`));
  }
  return q;
}));

// ---- Boxes ------------------------------------------------------------------------------------

export const createProjectStagingBox = withAuth(async (
  user,
  { tenant },
  projectId: string,
  input: { task_id?: string | null; name?: string | null; stock_location_id?: string | null; location_note?: string | null; notes?: string | null } = {},
): Promise<IStagingContainer | StagingActionError | StockConflictResult> => run(async () => {
  const g = await gate(user, tenant, projectId, 'update');
  if (isGateError(g)) return g;
  return createContainer(g.db, tenant, { ...input, project_id: projectId }, userId(user));
}));

export const updateProjectStagingBox = withAuth(async (
  user,
  { tenant },
  projectId: string,
  containerId: string,
  patch: { task_id?: string | null; name?: string | null; stock_location_id?: string | null; location_note?: string | null; notes?: string | null },
): Promise<IStagingContainer | StagingActionError | StockConflictResult> => run(async () => {
  const g = await gate(user, tenant, projectId, 'update');
  if (isGateError(g)) return g;
  await assertContainerInProject(g.db, tenant, projectId, containerId);
  return updateContainer(g.db, tenant, containerId, patch ?? {});
}));

export const deleteProjectStagingBox = withAuth(async (
  user,
  { tenant },
  projectId: string,
  containerId: string,
): Promise<{ deleted: true } | StagingActionError | StockConflictResult> => run(async () => {
  const g = await gate(user, tenant, projectId, 'update');
  if (isGateError(g)) return g;
  await assertContainerInProject(g.db, tenant, projectId, containerId);
  await deleteContainer(g.db, tenant, containerId, userId(user));
  return { deleted: true as const };
}));

export const setProjectStagingBoxSealed = withAuth(async (
  user,
  { tenant },
  projectId: string,
  containerId: string,
  sealed: boolean,
): Promise<IStagingContainer | StagingActionError | StockConflictResult> => run(async () => {
  const g = await gate(user, tenant, projectId, 'update');
  if (isGateError(g)) return g;
  await assertContainerInProject(g.db, tenant, projectId, containerId);
  return sealed ? sealContainer(g.db, tenant, containerId, userId(user)) : reopenContainer(g.db, tenant, containerId);
}));

export const packProjectStagingBox = withAuth(async (
  user,
  { tenant },
  projectId: string,
  containerId: string,
  items: PackItem[],
): Promise<IStagingContainerMember[] | StagingActionError | StockConflictResult> => run(async () => {
  const g = await gate(user, tenant, projectId, 'update');
  if (isGateError(g)) return g;
  await assertContainerInProject(g.db, tenant, projectId, containerId);
  return packLines(g.db, tenant, containerId, items, userId(user));
}));

export const unpackProjectStagingBox = withAuth(async (
  user,
  { tenant },
  projectId: string,
  containerId: string,
  lineId: string,
  quantity?: number | null,
): Promise<{ unpacked: true } | StagingActionError | StockConflictResult> => run(async () => {
  const g = await gate(user, tenant, projectId, 'update');
  if (isGateError(g)) return g;
  await assertContainerInProject(g.db, tenant, projectId, containerId);
  await unpackLine(g.db, tenant, containerId, lineId, quantity ?? null);
  return { unpacked: true as const };
}));

// ---- Project lifecycle (stale reservations) -----------------------------------------------------

/** How many stock claims a project still holds, for the complete/close warning. */
export const getProjectStagingClaimCount = withAuth(async (
  user,
  { tenant },
  projectId: string,
): Promise<{ activeClaims: number } | StagingActionError | StockConflictResult> => run(async () => {
  const g = await gate(user, tenant, projectId, 'read');
  if (isGateError(g)) return g;
  return { activeClaims: await countActiveStockClaims(g.db, tenant, projectId) };
}));

export const releaseAllProjectStaging = withAuth(async (
  user,
  { tenant },
  projectId: string,
): Promise<{ released: number } | StagingActionError | StockConflictResult> => run(async () => {
  const g = await gate(user, tenant, projectId, 'update');
  if (isGateError(g)) return g;
  return releaseAllProjectClaims(g.db, tenant, projectId, userId(user));
}));

// ---- Pickers -----------------------------------------------------------------------------------

/** The project's tasks (with their phase) for staging and box task pickers. */
export const listProjectStagingTasks = withAuth(async (
  user,
  { tenant },
  projectId: string,
): Promise<Array<{ task_id: string; task_name: string; phase_name: string }> | StagingActionError | StockConflictResult> => run(async () => {
  const g = await gate(user, tenant, projectId, 'read');
  if (isGateError(g)) return g;
  return g.db('project_tasks as t')
    .join('project_phases as ph', function () {
      this.on('ph.phase_id', '=', 't.phase_id').andOn('ph.tenant', '=', 't.tenant');
    })
    .where({ 't.tenant': tenant, 'ph.project_id': projectId })
    .select('t.task_id', 't.task_name', 'ph.phase_name')
    .orderBy('ph.order_number', 'asc')
    .orderBy('t.wbs_code', 'asc')
    .limit(1000);
}));

/** Active stock locations, for where a box physically is. Informational only: staging moves no stock. */
export const listProjectStagingLocations = withAuth(async (
  user,
  { tenant },
  projectId: string,
): Promise<Array<{ location_id: string; name: string }> | StagingActionError | StockConflictResult> => run(async () => {
  const g = await gate(user, tenant, projectId, 'read');
  if (isGateError(g)) return g;
  return g.db('stock_locations').where({ tenant, is_active: true }).select('location_id', 'name').orderBy('name', 'asc');
}));
