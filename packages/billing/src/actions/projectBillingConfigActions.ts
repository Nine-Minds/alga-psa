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
import {
  computeEntryAmounts,
  resolveInvoiceCurrency,
  validateAllocation,
} from '../services/projectBillingService';
import { persistProjectBillingConfigUpdate } from '../services/projectBillingConfigUpdateService';
import { withProjectBillingActionErrors } from './projectBillingActionErrors';
import {
  ticketProjectAttributionJoin,
  ticketProjectIdExpression,
} from '@alga-psa/shared/billingClients/ticketProjectAttribution';

// View DTOs live in @alga-psa/types — import them from there. A type re-export
// here breaks at runtime: the 'use server' transform registers every export as
// a server reference, emitting value references to type-only names.

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

export interface RecalculateProjectTotalResult {
  config: IProjectBillingConfig;
  entries: ScheduleEntryView[];
  rollup: { allocated: number; total: number; delta: 0 };
}

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

async function readClientDefaultCurrency(
  connection: DbConnection,
  tenant: string,
  clientId: string,
): Promise<string | null> {
  const client = await tenantDb(connection, tenant).table('clients')
    .where({ client_id: clientId })
    .select('default_currency_code')
    .first<{ default_currency_code: string | null }>();
  if (!client) {
    throw new Error('Client not found for project');
  }
  return client.default_currency_code?.toUpperCase() || null;
}

async function listActiveContractCurrencies(
  connection: DbConnection,
  tenant: string,
  clientId: string,
): Promise<string[]> {
  const db = tenantDb(connection, tenant);
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
  return Array.from(new Set(currencyRows.map((row) => row.currency_code.toUpperCase())));
}

async function resolveTenantDefaultCurrency(
  connection: DbConnection,
  tenant: string,
): Promise<string> {
  const settings = await tenantDb(connection, tenant).table('default_billing_settings')
    .select('default_currency_code')
    .first<{ default_currency_code: string | null }>();
  return (settings?.default_currency_code || 'USD').toUpperCase();
}

async function resolveClientBillingCurrencyInternal(
  connection: DbConnection,
  tenant: string,
  clientId: string,
): Promise<string> {
  // The client's own currency outranks its contracts. A project is billed to
  // the client, not through some unrelated active contract, and the client
  // default is what the invoice run itself bills in when no single contract
  // currency is due in the period. Letting a legacy contract
  // win pinned new projects to its currency forever, with no stale-currency
  // notice, because the stored and the freshly resolved currency always agreed.
  // Quotes resolve in this order too.
  const clientCurrency = await readClientDefaultCurrency(connection, tenant, clientId);
  if (clientCurrency) return clientCurrency;

  // No client currency: the active contracts are the only remaining record of
  // what this client is billed in, so infer from them and only complain about
  // disagreement here, where there is nothing better to fall back on.
  const currencies = await listActiveContractCurrencies(connection, tenant, clientId);
  if (currencies.length > 1) {
    throw new Error(`Client has active contracts in multiple currencies (${currencies.join(', ')}).`);
  }
  if (currencies[0]) return currencies[0];

  return resolveTenantDefaultCurrency(connection, tenant);
}

/**
 * The currency this project's invoices will bill in, resolved by the engine's
 * own rule (`resolveInvoiceCurrency`): a contract line's rates are denominated
 * in its contract's currency, so a single active contract currency decides it,
 * and otherwise the client's own currency does.
 *
 * This is not the same question as the one above. The config's currency is
 * pinned to the client's own currency, and a client that signed a contract in
 * another currency is invoiced in *that* currency — which is the currency a cap
 * has to be counted in to be applied at all. Approximate where the engine is
 * exact: the engine reads the contract lines due in one billing period, while a
 * card has no period, so any active contract counts here.
 */
async function resolveProjectInvoiceCurrencyInternal(
  connection: DbConnection,
  tenant: string,
  clientId: string,
): Promise<string> {
  const [clientCurrency, contractCurrencies] = await Promise.all([
    readClientDefaultCurrency(connection, tenant, clientId),
    listActiveContractCurrencies(connection, tenant, clientId),
  ]);
  return resolveInvoiceCurrency(
    contractCurrencies,
    clientCurrency ?? (await resolveTenantDefaultCurrency(connection, tenant)),
  );
}

/**
 * Currencies a project under this client may be denominated in: the client's
 * own currency, plus any currency the client is actually invoiced in through an
 * active contract. The second half is what makes the invoice run's advice
 * ("set the project's billing currency to X and re-enter the cap") an
 * instruction the save accepts — without it a cap stranded by a contract in
 * another currency could never be re-pinned, and would sleep forever.
 */
async function resolveAllowedProjectCurrencies(
  connection: DbConnection,
  tenant: string,
  clientId: string,
): Promise<{ pinned: string; allowed: string[] }> {
  const pinned = await resolveClientBillingCurrencyInternal(connection, tenant, clientId);
  const contractCurrencies = await listActiveContractCurrencies(connection, tenant, clientId);
  return {
    pinned,
    allowed: Array.from(new Set([pinned, ...contractCurrencies])),
  };
}

function assertProjectCurrencyAllowed(
  candidate: string | null | undefined,
  { pinned, allowed }: { pinned: string; allowed: string[] },
): void {
  if (candidate && allowed.includes(candidate.toUpperCase())) return;
  if (allowed.length > 1) {
    throw new Error(
      `Project billing currency must be one of the currencies this client is billed in (${allowed.join(', ')})`,
    );
  }
  throw new Error(`Project billing currency must match the client's billing currency (${pinned})`);
}

// Fields are optional here (not required): the ee/server typecheck compiles
// this file with strictNullChecks off, where zod's inference of the parsed
// config collapses to all-optional. The runtime contract is unchanged.
function validateConfigModelFields(input: {
  billing_model?: 'fixed_price' | 'time_and_materials' | null;
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
        .select<{ phase_id: string; phase_name: string; end_date: Date | string | null }[]>(
          'phase_id',
          'phase_name',
          'end_date',
        ),
    invoiceIds.length === 0
      ? []
      : tenantDb(connection, tenant).table('invoices')
        .whereIn('invoice_id', invoiceIds)
        .select<{ invoice_id: string; invoice_number: string }[]>('invoice_id', 'invoice_number'),
  ]);
  const phasesById = new Map<string, { name: string; endDate: Date | string | null }>(
    phaseRows.map((row): [string, { name: string; endDate: Date | string | null }] => [
      row.phase_id,
      { name: row.phase_name, endDate: row.end_date },
    ]),
  );
  const invoiceNumbers = new Map<string, string>(
    invoiceRows.map((row): [string, string] => [row.invoice_id, row.invoice_number]),
  );
  const computedAmounts = computeEntryAmounts(config, entries);

  return entries.map((entry, index) => {
    const phaseDeleted = entry.trigger_type === 'phase'
      && (entry.phase_id === null || !phasesById.has(entry.phase_id));
    const phase = entry.phase_id ? phasesById.get(entry.phase_id) : undefined;
    return {
      ...entry,
      trigger_type: phaseDeleted ? 'manual' : entry.trigger_type,
      computed_amount: computedAmounts[index],
      phase_name: phase?.name ?? null,
      phase_end_date: phase?.endDate ?? null,
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
    LEFT JOIN project_tasks task
      ON task.tenant = te.tenant
     AND te.work_item_type = 'project_task'
     AND task.task_id = te.work_item_id
    LEFT JOIN project_phases phase
      ON phase.tenant = task.tenant
     AND phase.phase_id = task.phase_id
    ${ticketProjectAttributionJoin('te')}
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
      AND ${ticketProjectIdExpression('phase')} = ?
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
  const project = await requireProject(knex, tenant, projectId);
  const config = await ProjectBillingConfig.getByProject(projectId, knex);
  const economicsPromise = getProjectEconomics(knex, tenant, projectId, config);
  // Reading the overview must survive a client whose currency cannot be
  // resolved (no client record at all); the mismatch notice is simply not
  // shown in that case.
  const invoiceCurrencyPromise = resolveProjectInvoiceCurrencyInternal(
    knex,
    tenant,
    project.client_id,
  ).catch(() => null);

  if (!config) {
    return {
      config: null,
      entries: [],
      rollup: null,
      cap_usage: null,
      economics: await economicsPromise,
      overrides: [],
      invoice_billing_currency: await invoiceCurrencyPromise,
    };
  }

  const [entries, rollup, capUsage, economics, overrides, invoiceCurrency] = await Promise.all([
    listScheduleEntryViews(config, knex),
    ProjectBillingConfig.getRollupByProject(projectId, knex),
    ProjectBillingCapUsage.getByConfig(config.config_id, knex),
    economicsPromise,
    listOverrideViews(projectId, knex, tenant),
    invoiceCurrencyPromise,
  ]);
  return {
    config,
    entries,
    rollup,
    cap_usage: capUsage,
    economics,
    overrides,
    invoice_billing_currency: invoiceCurrency,
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
    const currencies = await resolveAllowedProjectCurrencies(trx, tenant, project.client_id);
    if (parsed.currency) {
      assertProjectCurrencyAllowed(parsed.currency, currencies);
    }

    // The required fields are restated explicitly (identical values): under
    // the ee/server typecheck (strictNullChecks off) zod infers the spread of
    // `parsed` as all-optional, which fails the model input's required props.
    return ProjectBillingConfig.insert({
      ...parsed,
      project_id: parsed.project_id,
      billing_model: parsed.billing_model,
      invoice_mode: parsed.invoice_mode,
      currency: parsed.currency?.toUpperCase() || currencies.pinned,
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
    if (Object.prototype.hasOwnProperty.call(parsed, 'currency')) {
      assertProjectCurrencyAllowed(
        parsed.currency,
        await resolveAllowedProjectCurrencies(trx, tenant, project.client_id),
      );
    }

    const candidate = { ...existing, ...parsed };
    validateConfigModelFields(candidate);
    const updated = await persistProjectBillingConfigUpdate(configId, parsed, entries, trx);

    // Cap usage is minor units of the old currency, and nothing billed while
    // the cap slept was ever counted, so neither figure means anything against
    // a cap in the new one. The re-pinned cap counts from zero.
    if (
      parsed.currency
      && existing.currency
      && parsed.currency.toUpperCase() !== existing.currency.toUpperCase()
    ) {
      await ProjectBillingCapUsage.reset(configId, trx);
    }

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

export const recalculateProjectTotalFromSchedule = withAuth(withProjectBillingActionErrors(async (
  user,
  { tenant },
  configId: string,
  expectedDelta: number,
): Promise<RecalculateProjectTotalResult> => {
  const { knex } = await createTenantKnex();
  await assertProjectBillingMutationPermission(user, knex);

  const result = await withTransaction(knex, async (trx) => {
    const db = tenantDb(trx, tenant);
    const lockedConfig = await db.table('project_billing_configs')
      .where({ config_id: configId })
      .forUpdate()
      .first();
    if (!lockedConfig) throw new Error('Project billing config not found');
    if (lockedConfig.billing_model !== 'fixed_price' || lockedConfig.total_price == null) {
      throw new Error('Only fixed-price project schedules can recalculate the project total');
    }
    await db.table('project_billing_schedule_entries')
      .where({ config_id: configId })
      .forUpdate()
      .select('schedule_entry_id');

    const config = await ProjectBillingConfig.getById(configId, trx);
    if (!config) throw new Error('Project billing config not found');
    const entries = await ProjectBillingScheduleEntry.listByConfig(configId, trx);
    const allocation = validateAllocation(config, entries);
    if (allocation.delta <= 0) {
      throw new Error('The schedule is no longer under-allocated. Refresh and review the current amounts.');
    }
    if (allocation.delta !== expectedDelta) {
      throw new Error('The schedule changed before the project total could be recalculated. Refresh and try again.');
    }

    const displayedAmounts = computeEntryAmounts(config, entries);
    const updatedAt = new Date().toISOString();
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (
        entry.status !== 'canceled'
        && entry.frozen_amount === null
        && entry.percentage !== null
        && ['pending', 'ready', 'held'].includes(entry.status)
      ) {
        await db.table('project_billing_schedule_entries')
          .where({ schedule_entry_id: entry.schedule_entry_id })
          .update({
            amount: displayedAmounts[index],
            percentage: null,
            updated_at: updatedAt,
          });
      }
    }

    const newTotal = entries.reduce(
      (sum, entry, index) => entry.status === 'canceled' ? sum : sum + displayedAmounts[index],
      0,
    );
    const refreshedEntries = await ProjectBillingScheduleEntry.listByConfig(configId, trx);
    const updatedConfig = await persistProjectBillingConfigUpdate(
      configId,
      { total_price: newTotal },
      refreshedEntries,
      trx,
    );
    const finalEntries = await ProjectBillingScheduleEntry.listByConfig(configId, trx);
    const finalAllocation = validateAllocation(updatedConfig, finalEntries);
    if (!finalAllocation.ok) {
      throw new Error('Project total recalculation did not produce a balanced schedule');
    }

    const amounts = computeEntryAmounts(updatedConfig, finalEntries);
    return {
      projectId: updatedConfig.project_id,
      config: updatedConfig,
      entries: finalEntries.map((entry, index) => ({
        ...entry,
        computed_amount: amounts[index],
        phase_name: null,
        phase_end_date: null,
        invoice_number: null,
        phase_deleted: false,
      })),
      rollup: { allocated: newTotal, total: newTotal, delta: 0 as const },
    };
  });

  revalidateProjectBilling(result.projectId);
  await publishEvent({
    eventType: 'PROJECT_BILLING_CONFIG_UPDATED',
    payload: {
      tenantId: tenant,
      projectId: result.projectId,
      configId,
      billingModel: result.config.billing_model,
      invoiceMode: result.config.invoice_mode,
      userId: user.user_id,
      changes: { total_price: result.config.total_price, source: 'schedule_recalculation' },
    },
  });
  return { config: result.config, entries: result.entries, rollup: result.rollup };
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
