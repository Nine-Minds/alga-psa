'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type {
  IProjectBillingCapUsage,
  IProjectBillingConfig,
  IProjectBillingScheduleEntry,
  IProjectPhaseRateOverride,
  IUserWithRoles,
  ProjectBillingEconomics,
  ProjectBillingOverview,
  ProjectBillingRollup,
  ScheduleEntryView,
} from '@alga-psa/types';
import type { Knex } from 'knex';
import { revalidatePath } from 'next/cache';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import ProjectBillingCapUsage from '../models/projectBillingCapUsage';
import ProjectBillingConfig from '../models/projectBillingConfig';
import ProjectBillingScheduleEntry from '../models/projectBillingScheduleEntry';
import ProjectPhaseRateOverride from '../models/projectPhaseRateOverride';
import {
  createProjectBillingConfigSchema,
  updateProjectBillingConfigSchema,
} from '../schemas/projectBillingSchemas';
import { computeEntryAmounts, validateAllocation } from '../services/projectBillingService';
import { withProjectBillingActionErrors } from './projectBillingActionErrors';

// View DTOs live in @alga-psa/types so cross-feature composition (projects,
// scheduling, msp-composition) can reference them without importing billing.
export type {
  ProjectBillingEconomics,
  ProjectBillingOverview,
  ProjectBillingRollup,
  ScheduleEntryView,
};

export interface ReadyQueueRow {
  entry: ScheduleEntryView;
  project_id: string;
  project_name: string;
  project_number: string;
  client_id: string;
  client_name: string;
  invoice_mode: 'recurring' | 'standalone';
  days_waiting: number;
  currency: string | null;
}

export interface CreateProjectBillingConfigActionInput {
  project_id: string;
  billing_model: 'fixed_price' | 'time_and_materials';
  total_price?: number;
  currency?: string;
  invoice_mode: 'recurring' | 'standalone';
  contract_id?: string | null;
  cap_amount?: number | null;
  cap_behavior?: 'notify' | 'hard_cap';
  cap_notify_thresholds?: number[];
  deposit_treatment?: 'credit' | 'deduct_final';
  is_taxable?: boolean;
}

export type UpdateProjectBillingConfigActionInput = Partial<Omit<
  CreateProjectBillingConfigActionInput,
  'project_id'
>>;

export interface UpsertPhaseRateOverrideActionInput {
  phase_id: string;
  service_id?: string | null;
  rate?: number | null;
  override_service_id?: string | null;
}

type DbConnection = Knex | Knex.Transaction;

async function assertBillingReadPermission(user: IUserWithRoles): Promise<void> {
  if (!await hasPermission(user, 'billing', 'read')) {
    throw new Error('Permission denied: Cannot view project billing');
  }
}

/** Mirrors invoiceGeneration's create-or-generate permission gate. */
export async function assertProjectBillingMutationPermission(
  user: IUserWithRoles,
  connection?: DbConnection,
): Promise<void> {
  const canCreate = await hasPermission(user, 'invoice', 'create', connection);
  const canGenerate = canCreate
    ? true
    : await hasPermission(user, 'invoice', 'generate', connection);
  if (!canCreate && !canGenerate) {
    throw new Error('Permission denied: invoice create or generate required');
  }
}

function revalidateProjectBilling(projectId: string): void {
  revalidatePath(`/msp/projects/${projectId}`);
  revalidatePath('/msp/billing');
}

async function requireProject(
  connection: DbConnection,
  tenant: string,
  projectId: string,
): Promise<{ project_id: string; client_id: string }> {
  const project = await tenantDb(connection, tenant).table('projects')
    .where({ project_id: projectId })
    .select('project_id', 'client_id')
    .first<{ project_id: string; client_id: string }>();
  if (!project) {
    throw new Error('Project not found');
  }
  return project;
}

async function resolveClientBillingCurrencyInternal(
  connection: DbConnection,
  tenant: string,
  clientId: string,
): Promise<string> {
  const db = tenantDb(connection, tenant);
  const client = await db.table('clients')
    .where({ client_id: clientId })
    .select('default_currency_code')
    .first<{ default_currency_code: string | null }>();
  if (!client) {
    throw new Error('Client not found for project');
  }

  const effectiveDate = new Date().toISOString().slice(0, 10);
  const currenciesQuery = db.table('client_contracts as client_contract');
  db.tenantJoin(
    currenciesQuery,
    'contracts as contract',
    'client_contract.contract_id',
    'contract.contract_id',
  );
  const currencyRows = await currenciesQuery
    .where({
      'client_contract.client_id': clientId,
      'client_contract.is_active': true,
    })
    .where('client_contract.start_date', '<=', effectiveDate)
    .where((builder) => {
      builder.whereNull('client_contract.end_date')
        .orWhere('client_contract.end_date', '>=', effectiveDate);
    })
    .whereNotNull('contract.currency_code')
    .distinct<{ currency_code: string }[]>('contract.currency_code');
  const currencies = Array.from(new Set(currencyRows.map((row) => row.currency_code.toUpperCase())));
  if (currencies.length > 1) {
    throw new Error(`Client has active contracts in multiple currencies (${currencies.join(', ')}).`);
  }
  if (currencies[0]) return currencies[0];
  if (client.default_currency_code) return client.default_currency_code.toUpperCase();

  const settings = await db.table('default_billing_settings')
    .select('default_currency_code')
    .first<{ default_currency_code: string | null }>();
  return (settings?.default_currency_code || 'USD').toUpperCase();
}

function validateConfigModelFields(input: {
  billing_model: 'fixed_price' | 'time_and_materials';
  total_price?: number | null;
}): void {
  if (input.billing_model === 'fixed_price' && input.total_price == null) {
    throw new Error('Fixed-price project billing requires total_price');
  }
}

async function listScheduleEntryViews(
  config: IProjectBillingConfig,
  connection: DbConnection,
): Promise<ScheduleEntryView[]> {
  const entries = await ProjectBillingScheduleEntry.listByConfig(config.config_id, connection);
  if (entries.length === 0) return [];

  const { tenant } = config;
  const phaseIds = Array.from(new Set(
    entries.map((entry) => entry.phase_id).filter((id): id is string => Boolean(id)),
  ));
  const invoiceIds = Array.from(new Set(
    entries.map((entry) => entry.invoice_id).filter((id): id is string => Boolean(id)),
  ));
  const [phaseRows, invoiceRows] = await Promise.all([
    phaseIds.length === 0
      ? []
      : tenantDb(connection, tenant).table('project_phases')
        .whereIn('phase_id', phaseIds)
        .select<{ phase_id: string; phase_name: string }[]>('phase_id', 'phase_name'),
    invoiceIds.length === 0
      ? []
      : tenantDb(connection, tenant).table('invoices')
        .whereIn('invoice_id', invoiceIds)
        .select<{ invoice_id: string; invoice_number: string }[]>('invoice_id', 'invoice_number'),
  ]);
  const phaseNames = new Map(phaseRows.map((row) => [row.phase_id, row.phase_name]));
  const invoiceNumbers = new Map(invoiceRows.map((row) => [row.invoice_id, row.invoice_number]));
  const computedAmounts = computeEntryAmounts(config, entries);

  return entries.map((entry, index) => {
    const phaseDeleted = entry.trigger_type === 'phase'
      && (entry.phase_id === null || !phaseNames.has(entry.phase_id));
    return {
      ...entry,
      trigger_type: phaseDeleted ? 'manual' : entry.trigger_type,
      computed_amount: computedAmounts[index],
      phase_name: entry.phase_id ? phaseNames.get(entry.phase_id) ?? null : null,
      invoice_number: entry.invoice_id ? invoiceNumbers.get(entry.invoice_id) ?? null : null,
      phase_deleted: phaseDeleted,
    };
  });
}

function firstRawRow(result: unknown): Record<string, unknown> {
  const candidate = result as {
    rows?: Record<string, unknown>[];
    0?: Record<string, unknown>[];
  };
  return candidate.rows?.[0] ?? candidate[0]?.[0] ?? {};
}

async function getProjectEconomics(
  connection: DbConnection,
  tenant: string,
  projectId: string,
  config: IProjectBillingConfig | null,
): Promise<ProjectBillingEconomics> {
  const settings = await tenantDb(connection, tenant).table('default_billing_settings')
    .select('default_currency_code')
    .first<{ default_currency_code: string | null }>();
  const defaultCurrency = (settings?.default_currency_code || 'USD').toUpperCase();

  // This is the cost-side query used by the profitability report, narrowed to
  // one project and without a date window. Actual time drives hours and labor.
  const laborResult = await connection.raw(`
    SELECT
      COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (te.end_time - te.start_time))) / 3600), 0) AS hours_logged,
      COALESCE(SUM(
        CASE WHEN resolved_rate.cost_rate IS NULL
          THEN GREATEST(0, EXTRACT(EPOCH FROM (te.end_time - te.start_time))) / 3600
          ELSE 0
        END
      ), 0) AS uncosted_hours,
      COALESCE(ROUND(SUM(
        (GREATEST(0, EXTRACT(EPOCH FROM (te.end_time - te.start_time))) / 3600)
        * COALESCE(resolved_rate.cost_rate, 0)
      )), 0) AS labor_cost
    FROM time_entries te
    JOIN project_tasks task
      ON task.tenant = te.tenant
     AND te.work_item_type = 'project_task'
     AND task.task_id = te.work_item_id
    JOIN project_phases phase
      ON phase.tenant = task.tenant
     AND phase.phase_id = task.phase_id
    LEFT JOIN LATERAL (
      SELECT rate.cost_rate
      FROM user_cost_rates rate
      WHERE rate.tenant = te.tenant
        AND (rate.user_id = te.user_id OR rate.user_id IS NULL)
        AND rate.effective_from <= te.work_date
        AND (rate.effective_to IS NULL OR rate.effective_to >= te.work_date)
      ORDER BY rate.user_id IS NULL, rate.effective_from DESC, rate.rate_id
      LIMIT 1
    ) resolved_rate ON true
    WHERE te.tenant = ?
      AND phase.project_id = ?
  `, [tenant, projectId]);

  // Prefer actual inventory COGS, as profitability does, and fall back to the
  // catalog standard cost when no same-currency movement cost is available.
  const materialResult = await connection.raw(`
    SELECT COALESCE(SUM(
      CASE
        WHEN COALESCE(actual_cogs.mismatched_count, 0) = 0
          AND actual_cogs.cogs_cents IS NOT NULL
          THEN actual_cogs.cogs_cents
        ELSE material.quantity * COALESCE(catalog.cost, 0)
      END
    ), 0) AS materials_cost
    FROM project_materials material
    LEFT JOIN service_catalog catalog
      ON catalog.tenant = material.tenant
     AND catalog.service_id = material.service_id
    LEFT JOIN LATERAL (
      SELECT
        SUM(movement.cogs_cost) FILTER (
          WHERE COALESCE(movement.cost_currency, inventory.cost_currency, ?) = ?
        ) AS cogs_cents,
        COUNT(*) FILTER (
          WHERE COALESCE(movement.cost_currency, inventory.cost_currency, ?) <> ?
        ) AS mismatched_count
      FROM stock_movements movement
      LEFT JOIN product_inventory_settings inventory
        ON inventory.tenant = movement.tenant
       AND inventory.service_id = movement.service_id
      WHERE movement.tenant = material.tenant
        AND movement.movement_type = 'consume'
        AND movement.source_doc_type = 'project_material'
        AND movement.source_doc_id = material.project_material_id
        AND movement.cogs_cost IS NOT NULL
    ) actual_cogs ON true
    WHERE material.tenant = ?
      AND material.project_id = ?
  `, [defaultCurrency, defaultCurrency, defaultCurrency, defaultCurrency, tenant, projectId]);

  const laborRow = firstRawRow(laborResult);
  const materialRow = firstRawRow(materialResult);
  const hoursLogged = Number(laborRow.hours_logged ?? 0);
  const uncostedHours = Number(laborRow.uncosted_hours ?? 0);
  const laborCost = Number(laborRow.labor_cost ?? 0);
  const materialsCost = Number(materialRow.materials_cost ?? 0);
  const projectedRevenue = config?.billing_model === 'fixed_price' ? config.total_price : null;
  const sameCurrency = !config?.currency || config.currency.toUpperCase() === defaultCurrency;
  const projectedMargin = projectedRevenue && projectedRevenue > 0 && sameCurrency
    ? ((projectedRevenue - laborCost - materialsCost) / projectedRevenue) * 100
    : null;

  return {
    hours_logged: Number.isFinite(hoursLogged) ? hoursLogged : 0,
    uncosted_hours: Number.isFinite(uncostedHours) ? uncostedHours : 0,
    labor_cost: Number.isFinite(laborCost) ? Math.round(laborCost) : 0,
    materials_cost: Number.isFinite(materialsCost) ? Math.round(materialsCost) : 0,
    cost_currency: defaultCurrency,
    currency_mismatch: !sameCurrency,
    projected_margin_pct: projectedMargin === null
      ? null
      : Math.round(projectedMargin * 100) / 100,
  };
}

async function listOverrideViews(
  projectId: string,
  connection: DbConnection,
  tenant: string,
): Promise<ProjectBillingOverview['overrides']> {
  const overrides = await ProjectPhaseRateOverride.listByProject(projectId, connection);
  if (overrides.length === 0) return [];

  const phaseIds = Array.from(new Set(overrides.map((override) => override.phase_id)));
  const serviceIds = Array.from(new Set(
    overrides.flatMap((override) => [override.service_id, override.override_service_id])
      .filter((id): id is string => Boolean(id)),
  ));
  const [phases, services] = await Promise.all([
    tenantDb(connection, tenant).table('project_phases')
      .whereIn('phase_id', phaseIds)
      .select<{ phase_id: string; phase_name: string }[]>('phase_id', 'phase_name'),
    serviceIds.length === 0
      ? []
      : tenantDb(connection, tenant).table('service_catalog')
        .whereIn('service_id', serviceIds)
        .select<{ service_id: string; service_name: string }[]>('service_id', 'service_name'),
  ]);
  const phaseNames = new Map<string, string>(
    phases.map((phase): [string, string] => [phase.phase_id, phase.phase_name]),
  );
  const serviceNames = new Map<string, string>(
    services.map((service): [string, string] => [service.service_id, service.service_name]),
  );

  return overrides.map((override) => ({
    ...override,
    phase_name: phaseNames.get(override.phase_id) ?? 'Deleted phase',
    service_name: override.service_id ? serviceNames.get(override.service_id) ?? null : null,
    override_service_name: override.override_service_id
      ? serviceNames.get(override.override_service_id) ?? null
      : null,
  }));
}

export const getProjectBillingOverview = withAuth(withProjectBillingActionErrors(async (
  user,
  { tenant },
  projectId: string,
): Promise<ProjectBillingOverview> => {
  await assertBillingReadPermission(user);
  const { knex } = await createTenantKnex();
  await requireProject(knex, tenant, projectId);
  const config = await ProjectBillingConfig.getByProject(projectId, knex);
  const economicsPromise = getProjectEconomics(knex, tenant, projectId, config);

  if (!config) {
    return {
      config: null,
      entries: [],
      rollup: null,
      cap_usage: null,
      economics: await economicsPromise,
      overrides: [],
    };
  }

  const [entries, rollup, capUsage, economics, overrides] = await Promise.all([
    listScheduleEntryViews(config, knex),
    ProjectBillingConfig.getRollupByProject(projectId, knex),
    ProjectBillingCapUsage.getByConfig(config.config_id, knex),
    economicsPromise,
    listOverrideViews(projectId, knex, tenant),
  ]);
  return {
    config,
    entries,
    rollup,
    cap_usage: capUsage,
    economics,
    overrides,
  };
}));

export const createProjectBillingConfig = withAuth(withProjectBillingActionErrors(async (
  user,
  { tenant },
  input: CreateProjectBillingConfigActionInput,
): Promise<IProjectBillingConfig> => {
  const { knex } = await createTenantKnex();
  await assertProjectBillingMutationPermission(user, knex);
  const parsed = createProjectBillingConfigSchema.parse({
    ...input,
    currency: input.currency?.toUpperCase(),
  });
  validateConfigModelFields(parsed);

  const created = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const project = await requireProject(trx, tenant, parsed.project_id);
    const clientCurrency = await resolveClientBillingCurrencyInternal(
      trx,
      tenant,
      project.client_id,
    );
    if (parsed.currency && parsed.currency.toUpperCase() !== clientCurrency) {
      throw new Error(`Project billing currency must match the client's billing currency (${clientCurrency})`);
    }

    return ProjectBillingConfig.insert({
      ...parsed,
      currency: clientCurrency,
      cap_behavior: parsed.cap_amount != null ? 'hard_cap' : parsed.cap_behavior,
    }, trx);
  });
  revalidateProjectBilling(created.project_id);
  await publishEvent({
    eventType: 'PROJECT_BILLING_CONFIG_CREATED',
    payload: {
      tenantId: tenant,
      projectId: created.project_id,
      configId: created.config_id,
      billingModel: created.billing_model,
      invoiceMode: created.invoice_mode,
      userId: user.user_id,
    },
  });
  return created;
}));

export const updateProjectBillingConfig = withAuth(withProjectBillingActionErrors(async (
  user,
  { tenant },
  configId: string,
  updates: UpdateProjectBillingConfigActionInput,
): Promise<IProjectBillingConfig> => {
  const { knex } = await createTenantKnex();
  await assertProjectBillingMutationPermission(user, knex);
  const { currency, ...updatesWithoutCurrency } = updates;
  const parsedInput = updateProjectBillingConfigSchema.parse({
    ...updatesWithoutCurrency,
    ...(currency !== undefined ? { currency: currency?.toUpperCase() } : {}),
  });
  const parsed = {
    ...parsedInput,
    ...(parsedInput.cap_amount != null || parsedInput.cap_behavior != null
      ? { cap_behavior: 'hard_cap' as const }
      : {}),
  };

  const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const existing = await ProjectBillingConfig.getById(configId, trx);
    if (!existing) throw new Error('Project billing config not found');

    const entries = await ProjectBillingScheduleEntry.listByConfig(configId, trx);
    if (parsed.billing_model && parsed.billing_model !== existing.billing_model) {
      if (entries.some((entry) => entry.status === 'invoiced')) {
        throw new Error('Billing model cannot be changed after a schedule entry has been invoiced');
      }
    }

    const project = await requireProject(trx, tenant, existing.project_id);
    const clientCurrency = await resolveClientBillingCurrencyInternal(
      trx,
      tenant,
      project.client_id,
    );
    if (Object.prototype.hasOwnProperty.call(parsed, 'currency')) {
      if (!parsed.currency || parsed.currency.toUpperCase() !== clientCurrency) {
        throw new Error(`Project billing currency must match the client's billing currency (${clientCurrency})`);
      }
    }

    const candidate = { ...existing, ...parsed };
    validateConfigModelFields(candidate);
    const updated = await ProjectBillingConfig.update(configId, parsed, trx);
    if (!updated) throw new Error('Project billing config not found');

    let allocationWarning: string | null = null;
    if (Object.prototype.hasOwnProperty.call(parsed, 'total_price')) {
      const allocation = validateAllocation(updated, entries);
      if (!allocation.ok) {
        allocationWarning = `Schedule allocation differs from total price by ${Math.abs(allocation.delta)} cents.`;
      }
    }

    // The locked return type remains IProjectBillingConfig; the extra plain
    // field lets callers surface the required non-blocking edit warning.
    return Object.assign(updated, { allocation_warning: allocationWarning });
  });
  revalidateProjectBilling(result.project_id);
  await publishEvent({
    eventType: 'PROJECT_BILLING_CONFIG_UPDATED',
    payload: {
      tenantId: tenant,
      projectId: result.project_id,
      configId: result.config_id,
      billingModel: result.billing_model,
      invoiceMode: result.invoice_mode,
      userId: user.user_id,
      changes: updates,
    },
  });
  return result;
}));

export const deleteProjectBillingConfig = withAuth(withProjectBillingActionErrors(async (
  user,
  { tenant },
  configId: string,
): Promise<void> => {
  const { knex } = await createTenantKnex();
  await assertProjectBillingMutationPermission(user, knex);
  const deletedConfig = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const config = await ProjectBillingConfig.getById(configId, trx);
    if (!config) throw new Error('Project billing config not found');
    const entries = await ProjectBillingScheduleEntry.listByConfig(configId, trx);
    if (entries.some((entry) => entry.status === 'invoiced')) {
      throw new Error('Project billing config cannot be deleted after an entry has been invoiced');
    }
    if (!await ProjectBillingConfig.delete(configId, trx)) {
      throw new Error('Project billing config not found');
    }
    return config;
  });
  revalidateProjectBilling(deletedConfig.project_id);
  await publishEvent({
    eventType: 'PROJECT_BILLING_CONFIG_DELETED',
    payload: {
      tenantId: tenant,
      projectId: deletedConfig.project_id,
      configId: deletedConfig.config_id,
      billingModel: deletedConfig.billing_model,
      invoiceMode: deletedConfig.invoice_mode,
      userId: user.user_id,
    },
  });
}));

export const upsertPhaseRateOverride = withAuth(withProjectBillingActionErrors(async (
  user,
  { tenant },
  input: UpsertPhaseRateOverrideActionInput,
): Promise<IProjectPhaseRateOverride> => {
  const { knex } = await createTenantKnex();
  await assertProjectBillingMutationPermission(user, knex);
  if (!input.phase_id) throw new Error('phase_id is required');
  if (input.rate == null && input.override_service_id == null) {
    throw new Error('A rate or replacement service is required');
  }
  if (input.rate != null && (!Number.isSafeInteger(input.rate) || input.rate < 0)) {
    throw new Error('Rate must be a non-negative integer number of cents');
  }

  const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const phase = await tenantDb(trx, tenant).table('project_phases')
      .where({ phase_id: input.phase_id })
      .select('phase_id', 'project_id')
      .first<{ phase_id: string; project_id: string }>();
    if (!phase) throw new Error('Project phase not found');
    if (!await ProjectBillingConfig.getByProject(phase.project_id, trx)) {
      throw new Error('Project billing is not enabled');
    }

    const referencedServiceIds = Array.from(new Set(
      [input.service_id, input.override_service_id].filter((id): id is string => Boolean(id)),
    ));
    if (referencedServiceIds.length > 0) {
      const services = await tenantDb(trx, tenant).table('service_catalog')
        .whereIn('service_id', referencedServiceIds)
        .select<{ service_id: string }[]>('service_id');
      if (services.length !== referencedServiceIds.length) {
        throw new Error('One of the selected services was not found');
      }
    }

    const existingQuery = tenantDb(trx, tenant).table('project_phase_rate_overrides')
      .where({ phase_id: input.phase_id });
    if (input.service_id) existingQuery.andWhere('service_id', input.service_id);
    else existingQuery.whereNull('service_id');
    const existing = await existingQuery.first<{ rate_override_id: string }>('rate_override_id');

    const override = existing
      ? await ProjectPhaseRateOverride.update(existing.rate_override_id, {
        service_id: input.service_id ?? null,
        rate: input.rate ?? null,
        override_service_id: input.override_service_id ?? null,
      }, trx)
      : await ProjectPhaseRateOverride.insert({
        phase_id: input.phase_id,
        service_id: input.service_id ?? null,
        rate: input.rate ?? null,
        override_service_id: input.override_service_id ?? null,
      }, trx);
    if (!override) throw new Error('Project phase rate override not found');
    return { override, projectId: phase.project_id };
  });
  revalidateProjectBilling(result.projectId);
  return result.override;
}));

export const deletePhaseRateOverride = withAuth(withProjectBillingActionErrors(async (
  user,
  { tenant },
  overrideId: string,
): Promise<void> => {
  const { knex } = await createTenantKnex();
  await assertProjectBillingMutationPermission(user, knex);
  const projectId = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const override = await ProjectPhaseRateOverride.getById(overrideId, trx);
    if (!override) throw new Error('Project phase rate override not found');
    const phase = await tenantDb(trx, tenant).table('project_phases')
      .where({ phase_id: override.phase_id })
      .select('project_id')
      .first<{ project_id: string }>();
    if (!phase) throw new Error('Project phase not found');
    if (!await ProjectPhaseRateOverride.delete(overrideId, trx)) {
      throw new Error('Project phase rate override not found');
    }
    return phase.project_id;
  });
  revalidateProjectBilling(projectId);
}));
