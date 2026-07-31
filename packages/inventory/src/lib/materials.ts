import { Knex } from 'knex';
import {
  IProjectMaterial,
  IServicePrice,
  IStockUnit,
  ITicketMaterial,
  type ProjectMaterialBillingDestination,
} from '@alga-psa/types';
import { recordStockConsumption, reverseStockConsumption } from './consume';
import { publishInventoryEvent } from './inventoryEvents';
import { collectDefaultLocationStockLowSignalAfterConsume } from './stockLowSignal';
import { resolveTenantCurrency } from './tenantCurrency';

/**
 * Lib-layer transaction helper (this file must stay importable without the
 * server-action stack, so no @alga-psa/db here). Reuses a passed-in transaction
 * (savepoint-free, caller owns commit) or opens one on a plain knex handle —
 * the same reuse semantics as @alga-psa/db withTransaction.
 */
function runInTransaction<T>(db: Knex, fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
  const maybe = db as unknown as { commit?: unknown; rollback?: unknown };
  if (typeof maybe.commit === 'function' && typeof maybe.rollback === 'function') {
    return fn(db as unknown as Knex.Transaction);
  }
  return db.transaction(fn);
}

/**
 * Canonical ticket/project materials service (F048). The tickets, projects, and
 * billing action wrappers and the REST API TicketService all delegate here —
 * one code path for validation, stock consumption, serialized-unit handling,
 * asset creation, and reversal. Permission gating stays in the wrappers (they
 * hold the user); this layer owns the semantics.
 */

export type MaterialParentType = 'ticket' | 'project';

export class MaterialValidationError extends Error {
  constructor(message: string, public readonly path: string) {
    super(message);
    this.name = 'MaterialValidationError';
  }
}

const PARENTS = {
  ticket: {
    table: 'ticket_materials',
    pk: 'ticket_material_id',
    parentCol: 'ticket_id',
    parentTable: 'tickets',
    parentPk: 'ticket_id',
    sourceDocType: 'ticket_material',
    label: 'ticket',
  },
  project: {
    table: 'project_materials',
    pk: 'project_material_id',
    parentCol: 'project_id',
    parentTable: 'projects',
    parentPk: 'project_id',
    sourceDocType: 'project_material',
    label: 'project',
  },
} as const;

export type MaterialRow = (ITicketMaterial | IProjectMaterial) & {
  service_name?: string | null;
  sku?: string | null;
};

export interface AddMaterialInput {
  parent_type: MaterialParentType;
  parent_id: string;
  /** Derived from the parent when omitted (REST API path). */
  client_id?: string | null;
  service_id: string;
  quantity: number;
  rate: number; // cents
  currency_code?: string | null;
  description?: string | null;
  /** Project-only invoice routing. Defaults from the project billing currency when omitted. */
  billing_destination?: ProjectMaterialBillingDestination;
  /** Project-only schedule link; required only for the schedule_entry destination. */
  billing_schedule_entry_id?: string | null;
  /** Serialized: the picked stock unit to deliver. Required for serialized tracked products. */
  unit_id?: string | null;
}

export interface UpdateProjectMaterialBillingInput {
  rate: number;
  billing_destination: ProjectMaterialBillingDestination;
  billing_schedule_entry_id?: string | null;
}

export interface ProjectMaterialEligibilityContext {
  mode: 'project_invoice' | 'separate_invoice';
  selectedScheduleEntryIds?: ReadonlySet<string>;
  projectClosed?: boolean;
}

export function isProjectMaterialEligible(
  material: Pick<IProjectMaterial, 'billing_destination' | 'billing_schedule_entry_id'>,
  context: ProjectMaterialEligibilityContext,
): boolean {
  switch (material.billing_destination) {
    case 'next_project_invoice':
      return context.mode === 'project_invoice';
    case 'schedule_entry':
      return context.mode === 'project_invoice'
        && Boolean(material.billing_schedule_entry_id)
        && Boolean(context.selectedScheduleEntryIds?.has(material.billing_schedule_entry_id!));
    case 'separate':
      return context.mode === 'separate_invoice';
    case 'project_completion':
      return context.mode === 'project_invoice' && context.projectClosed === true;
    case 'on_hold':
      return false;
    default: {
      const exhaustive: never = material.billing_destination;
      throw new MaterialValidationError(`Unknown project material billing destination: ${String(exhaustive)}`, 'billing_destination');
    }
  }
}

export async function listMaterials(
  db: Knex,
  tenant: string,
  parentType: MaterialParentType,
  parentId: string,
): Promise<MaterialRow[]> {
  const cfg = PARENTS[parentType];
  return runInTransaction(db, async (trx: Knex.Transaction) => {
    const rows = await trx(`${cfg.table} as m`)
      .leftJoin('service_catalog as sc', function () {
        this.on('m.service_id', '=', 'sc.service_id').andOn('m.tenant', '=', 'sc.tenant');
      })
      .where({ 'm.tenant': tenant, [`m.${cfg.parentCol}`]: parentId })
      .select(
        'm.*',
        'sc.service_name as service_name',
        'sc.sku as sku',
        'sc.cost as catalog_unit_cost',
        'sc.cost_currency as catalog_cost_currency',
      )
      .orderBy('m.created_at', 'desc');
    return rows as MaterialRow[];
  });
}

export async function addMaterial(
  db: Knex,
  tenant: string,
  input: AddMaterialInput,
  performedBy: string | null,
): Promise<MaterialRow> {
  const cfg = PARENTS[input.parent_type];

  const quantity = Math.floor(Number(input.quantity));
  if (!Number.isFinite(quantity) || quantity < 1) {
    throw new MaterialValidationError('quantity must be greater than 0', 'quantity');
  }
  const rate = Math.round(Number(input.rate));
  if (!Number.isFinite(rate) || rate < 0) {
    throw new MaterialValidationError('rate must be 0 or greater', 'rate');
  }

  const { row, pendingAsset, pendingStockLow } = await runInTransaction(db, async (trx: Knex.Transaction) => {
    const parent = await trx(cfg.parentTable)
      .where({ tenant, [cfg.parentPk]: input.parent_id })
      .select(cfg.parentPk, 'client_id')
      .first();
    if (!parent) {
      throw new MaterialValidationError(`${cfg.label} not found`, cfg.parentCol);
    }
    const clientId = input.client_id ?? parent.client_id ?? null;
    if (!clientId) {
      throw new MaterialValidationError(`${cfg.label} must be associated with a client`, 'client_id');
    }

    const product = await trx('service_catalog')
      .where({ tenant, service_id: input.service_id, item_kind: 'product' })
      .select('service_id')
      .first();
    if (!product) {
      throw new MaterialValidationError('service_id must reference an existing product', 'service_id');
    }

    const settings = await trx('product_inventory_settings')
      .where({ tenant, service_id: input.service_id })
      .select('track_stock', 'is_serialized')
      .first();
    if (settings?.track_stock && settings.is_serialized) {
      if (!input.unit_id) {
        throw new MaterialValidationError('A serial-numbered unit must be selected for this product', 'unit_id');
      }
      if (quantity !== 1) {
        throw new MaterialValidationError('Serialized products are added one unit at a time', 'quantity');
      }
    }

    const materialCurrency = input.currency_code || await resolveTenantCurrency(trx, tenant);
    let projectBillingDestination: ProjectMaterialBillingDestination | undefined;
    let projectBillingScheduleEntryId: string | null = null;
    if (input.parent_type === 'project') {
      const billingConfig = await trx('project_billing_configs')
        .where({ tenant, project_id: input.parent_id })
        .select('config_id', 'currency')
        .first();
      projectBillingDestination = input.billing_destination ?? (billingConfig?.currency
        && billingConfig.currency !== materialCurrency
        ? 'separate'
        : 'next_project_invoice');
      projectBillingScheduleEntryId = input.billing_schedule_entry_id ?? null;
      if (billingConfig?.currency && billingConfig.currency !== materialCurrency && projectBillingDestination !== 'separate') {
        throw new MaterialValidationError(
          `Products in ${materialCurrency} must use a separate product invoice because the project bills in ${billingConfig.currency}`,
          'billing_destination',
        );
      }
      if (projectBillingDestination === 'schedule_entry') {
        if (!projectBillingScheduleEntryId) {
          throw new MaterialValidationError('A billing schedule entry is required', 'billing_schedule_entry_id');
        }
        if (!billingConfig) {
          throw new MaterialValidationError('This project does not have a billing schedule', 'billing_destination');
        }
        const scheduleEntry = await trx('project_billing_schedule_entries')
          .where({
            tenant,
            schedule_entry_id: projectBillingScheduleEntryId,
            config_id: billingConfig.config_id,
          })
          .whereNot('status', 'canceled')
          .first('schedule_entry_id');
        if (!scheduleEntry) {
          throw new MaterialValidationError(
            'The selected billing schedule entry does not belong to this project or is canceled',
            'billing_schedule_entry_id',
          );
        }
      } else if (projectBillingScheduleEntryId) {
        throw new MaterialValidationError(
          'billing_schedule_entry_id is only valid for the schedule entry destination',
          'billing_schedule_entry_id',
        );
      }
    }

    const [row] = await trx(cfg.table)
      .insert({
        tenant,
        [cfg.parentCol]: input.parent_id,
        client_id: clientId,
        service_id: input.service_id,
        quantity,
        rate,
        currency_code: materialCurrency,
        description: input.description ?? null,
        is_billed: false,
        ...(projectBillingDestination ? {
          billing_destination: projectBillingDestination,
          billing_schedule_entry_id: projectBillingDestination === 'schedule_entry'
            ? projectBillingScheduleEntryId
            : null,
        } : {}),
      })
      .returning('*');

    // Inventory: decrement stock for track_stock products (serialized delivers the
    // picked unit). No-op for untracked products. Throws InsufficientStockError
    // rather than going negative (F014).
    const consumption = await recordStockConsumption(trx, tenant, {
      service_id: row.service_id,
      quantity: row.quantity,
      source_doc_type: cfg.sourceDocType,
      source_doc_id: row[cfg.pk],
      performed_by: performedBy,
      unit_id: input.unit_id ?? null,
      client_id: clientId,
    });

    const pendingStockLow = consumption.consumed
      ? await collectDefaultLocationStockLowSignalAfterConsume(trx, tenant, row.service_id, row.quantity)
      : null;

    return { row, pendingAsset: consumption.pending_asset_link ?? null, pendingStockLow };
  });

  // F044: a serialized install creates the managed asset like SO fulfillment does —
  // after commit (F029), and never failing the material itself. Lazy import: assetLink
  // pulls the assets-actions stack, which must not load at lib import time (vitest).
  if (pendingAsset) {
    try {
      const { createAndLinkDeliveredAsset } = await import('./assetLink');
      await createAndLinkDeliveredAsset(db, tenant, pendingAsset);
    } catch (e) {
      console.error(`Asset creation for delivered ${cfg.label}-material unit failed:`, e);
    }
  }
  if (pendingStockLow) {
    await publishInventoryEvent('INVENTORY_STOCK_LOW', pendingStockLow);
  }
  return row as MaterialRow;
}

export async function updateProjectMaterialBilling(
  db: Knex,
  tenant: string,
  projectMaterialId: string,
  input: UpdateProjectMaterialBillingInput,
): Promise<MaterialRow> {
  const rate = Math.round(Number(input.rate));
  if (!Number.isFinite(rate) || rate < 0) {
    throw new MaterialValidationError('rate must be 0 or greater', 'rate');
  }

  return runInTransaction(db, async (trx) => {
    const material = await trx('project_materials as material')
      .innerJoin('projects as project', function joinProject() {
        this.on('project.tenant', '=', 'material.tenant')
          .andOn('project.project_id', '=', 'material.project_id');
      })
      .leftJoin('project_billing_configs as config', function joinBillingConfig() {
        this.on('config.tenant', '=', 'material.tenant')
          .andOn('config.project_id', '=', 'material.project_id');
      })
      .where({ 'material.tenant': tenant, 'material.project_material_id': projectMaterialId })
      .select('material.*', 'config.config_id', 'config.currency as project_currency')
      .forUpdate()
      .first();

    if (!material) {
      throw new MaterialValidationError('Project material not found', 'project_material_id');
    }
    if (material.is_billed) {
      throw new MaterialValidationError('Billed project materials cannot be edited', 'project_material_id');
    }

    const scheduleEntryId = input.billing_schedule_entry_id ?? null;
    if (input.billing_destination === 'schedule_entry') {
      if (!scheduleEntryId) {
        throw new MaterialValidationError('A billing schedule entry is required', 'billing_schedule_entry_id');
      }
      const scheduleEntry = await trx('project_billing_schedule_entries')
        .where({ tenant, schedule_entry_id: scheduleEntryId, config_id: material.config_id })
        .whereNot('status', 'canceled')
        .first('schedule_entry_id');
      if (!scheduleEntry) {
        throw new MaterialValidationError(
          'The selected billing schedule entry does not belong to this project or is canceled',
          'billing_schedule_entry_id',
        );
      }
    } else if (scheduleEntryId) {
      throw new MaterialValidationError(
        'billing_schedule_entry_id is only valid for the schedule entry destination',
        'billing_schedule_entry_id',
      );
    }

    if (
      material.project_currency
      && material.currency_code !== material.project_currency
      && input.billing_destination !== 'separate'
    ) {
      throw new MaterialValidationError(
        `Products in ${material.currency_code} must use a separate product invoice because the project bills in ${material.project_currency}`,
        'billing_destination',
      );
    }

    const [updated] = await trx('project_materials')
      .where({ tenant, project_material_id: projectMaterialId, is_billed: false })
      .update({
        rate,
        billing_destination: input.billing_destination,
        billing_schedule_entry_id: input.billing_destination === 'schedule_entry' ? scheduleEntryId : null,
        updated_at: new Date().toISOString(),
      })
      .returning('*');
    if (!updated) {
      throw new MaterialValidationError('Project material changed before it could be updated', 'project_material_id');
    }
    return updated as MaterialRow;
  });
}

/** Returns false when the material does not exist. Throws on billed materials. */
export async function deleteMaterial(
  db: Knex,
  tenant: string,
  parentType: MaterialParentType,
  materialId: string,
  performedBy: string | null,
): Promise<boolean> {
  const cfg = PARENTS[parentType];
  return runInTransaction(db, async (trx: Knex.Transaction) => {
    const row = await trx(cfg.table)
      .where({ tenant, [cfg.pk]: materialId })
      .select('is_billed', 'service_id', 'quantity')
      .first();

    if (!row) return false;
    if (row.is_billed) {
      throw new Error('Cannot delete a billed material.');
    }

    // Inventory: restore stock consumed when this (unbilled) material was added.
    await reverseStockConsumption(trx, tenant, {
      service_id: row.service_id,
      quantity: row.quantity,
      source_doc_type: cfg.sourceDocType,
      source_doc_id: materialId,
      performed_by: performedBy,
    });

    await trx(cfg.table).where({ tenant, [cfg.pk]: materialId }).delete();
    return true;
  });
}

// ---- Shared picker queries (single implementation behind the tickets/projects wrappers) ----

export interface CatalogPickerSearchOptions {
  search?: string;
  page?: number;
  limit?: number;
  is_active?: boolean;
  item_kinds?: Array<'service' | 'product'>;
  billing_methods?: Array<'fixed' | 'hourly' | 'usage' | 'per_unit'>;
}

export interface CatalogPickerQueryRow {
  service_id: string;
  service_name: string;
  billing_method: string | null;
  unit_of_measure: string | null;
  item_kind: string;
  sku: string | null;
  default_rate: number;
  cost: number | null;
  cost_currency: string | null;
  track_stock?: boolean;
  on_hand_total?: number | null;
  reorder_point?: number | null;
}

export async function queryCatalogPickerItems(
  trx: Knex.Transaction,
  tenant: string,
  options: CatalogPickerSearchOptions = {},
): Promise<{ items: CatalogPickerQueryRow[]; totalCount: number }> {
  const page = options.page ?? 1;
  const limit = options.limit ?? 10;
  const offset = (page - 1) * limit;
  const searchTerm = options.search?.trim() ? `%${options.search.trim()}%` : null;

  const base = trx('service_catalog as sc').where({ 'sc.tenant': tenant });

  if (options.is_active !== undefined) {
    base.andWhere('sc.is_active', options.is_active);
  }
  if (options.item_kinds?.length) {
    base.andWhere((qb) => qb.whereIn('sc.item_kind', options.item_kinds!));
  }
  if (options.billing_methods?.length) {
    base.andWhere((qb) => qb.whereIn('sc.billing_method', options.billing_methods!));
  }
  if (searchTerm) {
    base.andWhere((qb) => {
      qb.whereILike('sc.service_name', searchTerm)
        .orWhereILike('sc.description', searchTerm)
        .orWhereILike('sc.sku', searchTerm);
    });
  }

  const countResult = await base.clone().count('sc.service_id as count').first();
  const totalCount = parseInt(countResult?.count as string) || 0;

  const rows = await base
    .clone()
    .leftJoin('product_inventory_settings as pis', function () {
      this.on('pis.service_id', '=', 'sc.service_id').andOn('pis.tenant', '=', 'sc.tenant');
    })
    .select(
      'sc.service_id',
      'sc.service_name',
      'sc.billing_method',
      'sc.unit_of_measure',
      'sc.item_kind',
      'sc.sku',
      trx.raw('CAST(sc.default_rate AS FLOAT) as default_rate'),
      trx.raw('CAST(sc.cost AS FLOAT) as cost'),
      'sc.cost_currency',
      'pis.track_stock',
      'pis.reorder_point',
      trx.raw(
        `(SELECT COALESCE(SUM(sl.quantity_on_hand), 0) FROM stock_levels sl
          WHERE sl.tenant = sc.tenant AND sl.service_id = sc.service_id) as on_hand_total`
      ),
    )
    .orderBy('sc.service_name', 'asc')
    .limit(limit)
    .offset(offset);

  return {
    items: rows.map((r: any) => ({
      ...r,
      track_stock: !!r.track_stock,
      on_hand_total: r.track_stock ? Number(r.on_hand_total ?? 0) : null,
      reorder_point: r.reorder_point ?? null,
    })) as CatalogPickerQueryRow[],
    totalCount,
  };
}

export async function queryServicePrices(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
): Promise<IServicePrice[]> {
  const rows = await trx('service_prices')
    .where({ tenant, service_id: serviceId })
    .select('*')
    .orderBy('currency_code', 'asc');
  return rows as IServicePrice[];
}

export async function queryAvailableStockUnits(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
): Promise<IStockUnit[]> {
  return (await trx('stock_units')
    .where({ tenant, service_id: serviceId, status: 'in_stock' })
    .orderBy('received_at', 'asc')) as IStockUnit[];
}
