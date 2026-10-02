import { Knex } from 'knex';
import { withUnitCode } from '@alga-psa/core/unitOfMeasure';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import type { IContractLine, IContractLineMapping } from '@alga-psa/types';
import { resolveBillingCycleAlignmentForCompatibility } from '@alga-psa/shared/billingClients/billingCycleAlignmentCompatibility';
import {
  DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER,
  resolveRecurringAuthoringPolicy,
} from '@alga-psa/shared/billingClients/recurringAuthoringPolicy';
import {
  normalizeLiveRecurringStorage,
  normalizeTemplateRecurringStorage,
} from '@alga-psa/shared/billingClients/recurrenceStorageModel';
import { cloneTemplateLinePools } from '@alga-psa/shared/billingClients/templateClone';
import { resolveClonedRate } from '../lib/billing/pricing/resolveFixedLineRate';

export type DetailedContractLine = IContractLineMapping & {
  contract_line_name?: string;
  contract_line_type?: string;
  billing_frequency?: string;
  rate?: number | null;
  enable_proration?: boolean;
  billing_cycle_alignment?: 'start' | 'end' | 'prorated';
};

type TenantScopedKnex = Knex | Knex.Transaction;

function tenantScopedTable(knex: TenantScopedKnex, tenant: string, table: string): Knex.QueryBuilder {
  return tenantDb(knex, tenant).table(table);
}

async function isTemplateContract(knex: TenantScopedKnex, tenant: string, contractId: string): Promise<boolean> {
  const record = await tenantScopedTable(knex, tenant, 'contract_templates')
    .where('template_id', contractId)
    .first('template_id');

  return Boolean(record);
}

function mapContractLineRow(row: any): IContractLineMapping {
  const recurringStorage = normalizeLiveRecurringStorage(row);
  return {
    tenant: recurringStorage.tenant,
    contract_id: recurringStorage.contract_id,
    contract_line_id: recurringStorage.contract_line_id,
    display_order: recurringStorage.display_order ?? 0,
    custom_rate: recurringStorage.custom_rate ?? null,
    rate_provenance: row.rate_provenance ?? null,
    billing_timing: recurringStorage.billing_timing,
    cadence_owner: recurringStorage.cadence_owner,
    location_id: row.location_id ?? null,
    created_at: recurringStorage.created_at,
  };
}

export async function fetchContractLineMappings(
  knex: TenantScopedKnex,
  tenant: string,
  contractId: string
): Promise<IContractLineMapping[]> {
  const template = await isTemplateContract(knex, tenant, contractId);

  if (template) {
    const rows = await tenantScopedTable(knex, tenant, 'contract_template_lines')
      .where('template_id', contractId)
      .orderBy('display_order', 'asc')
      .select([
        'tenant',
        'template_id as contract_id',
        'template_line_id as contract_line_id',
        'display_order',
        'custom_rate',
        'billing_timing',
        'cadence_owner',
        'created_at',
      ]);
    return rows.map(mapContractLineRow);
  }

  const rows = await tenantScopedTable(knex, tenant, 'contract_lines')
    .where('contract_id', contractId)
    .orderBy('display_order', 'asc')
    .select([
      'tenant',
      'contract_id',
      'contract_line_id',
      'display_order',
      'custom_rate',
      'rate_provenance',
      'billing_timing',
      'cadence_owner',
      'location_id',
      'created_at',
    ]);
  return rows.map(mapContractLineRow);
}

export async function fetchDetailedContractLines(
  knex: TenantScopedKnex,
  tenant: string,
  contractId: string
): Promise<DetailedContractLine[]> {
  const template = await isTemplateContract(knex, tenant, contractId);

  if (template) {
    const db = tenantDb(knex, tenant);
    const query = db.table('contract_template_lines as lines');
    db.tenantJoin(query, 'contract_template_line_fixed_config as fixed', 'fixed.template_line_id', 'lines.template_line_id', {
      type: 'left',
    });

    const rows = await query
      .where('lines.template_id', contractId)
      .select([
        'lines.tenant',
        'lines.template_id as contract_id',
        'lines.template_line_id as contract_line_id',
        'lines.display_order',
        'lines.custom_rate',
        'lines.billing_timing',
        'lines.cadence_owner',
        'lines.created_at',
        'lines.template_line_name as contract_line_name',
        'lines.line_type as contract_line_type',
        'lines.billing_frequency',
        'fixed.base_rate as default_rate',
        'fixed.enable_proration as template_enable_proration',
        'fixed.billing_cycle_alignment as template_billing_cycle_alignment',
      ])
      .orderBy('lines.display_order', 'asc');

    return rows.map((row: any) => ({
      ...mapContractLineRow(
        normalizeTemplateRecurringStorage({
          ...row,
          custom_rate:
            row.custom_rate ?? (row.default_rate != null ? Number(row.default_rate) : null),
        }),
      ),
      contract_line_name: row.contract_line_name,
      contract_line_type: row.contract_line_type,
      billing_frequency: row.billing_frequency,
      rate:
        row.custom_rate !== undefined && row.custom_rate !== null
          ? Number(row.custom_rate)
          : row.default_rate != null
            ? Number(row.default_rate)
            : null,
      enable_proration: row.template_enable_proration ?? false,
      billing_cycle_alignment: resolveBillingCycleAlignmentForCompatibility({
        billingCycleAlignment: row.template_billing_cycle_alignment,
        enableProration: row.template_enable_proration,
      }),
    }));
  }

  const rows = await tenantScopedTable(knex, tenant, 'contract_lines as cl')
    .where('cl.contract_id', contractId)
    .select([
      'cl.tenant',
      'cl.contract_id',
      'cl.contract_line_id',
      'cl.display_order',
      'cl.custom_rate',
      'cl.rate_provenance',
      'cl.billing_timing',
      'cl.cadence_owner',
      'cl.location_id',
      'cl.billing_profile_id',
      'cl.created_at',
      'cl.contract_line_name',
      'cl.contract_line_type',
      'cl.billing_frequency',
      'cl.enable_proration',
      'cl.billing_cycle_alignment',
    ])
    .orderBy('cl.display_order', 'asc');

  return rows.map((row: any) => ({
      ...mapContractLineRow(
        normalizeLiveRecurringStorage({
          ...row,
          custom_rate: row.custom_rate ?? null,
        }),
      ),
      contract_line_name: row.contract_line_name,
      contract_line_type: row.contract_line_type,
      billing_frequency: row.billing_frequency,
    rate: row.custom_rate !== undefined && row.custom_rate !== null ? Number(row.custom_rate) : null,
    enable_proration: row.enable_proration ?? false,
    billing_cycle_alignment: resolveBillingCycleAlignmentForCompatibility({
      billingCycleAlignment: row.billing_cycle_alignment,
      enableProration: row.enable_proration,
    }),
  }));
}

export async function isContractLineAttached(
  knex: TenantScopedKnex,
  tenant: string,
  contractId: string,
  contractLineId: string
): Promise<boolean> {
  const template = await isTemplateContract(knex, tenant, contractId);

  if (template) {
    const record = await tenantScopedTable(knex, tenant, 'contract_template_lines')
      .where({ template_id: contractId, template_line_id: contractLineId })
      .first('template_line_id');
    return Boolean(record);
  }

  const record = await tenantScopedTable(knex, tenant, 'contract_lines')
    .where({ contract_id: contractId, contract_line_id: contractLineId })
    .first('contract_line_id');
  return Boolean(record);
}

export async function ensureTemplateLineSnapshot(
  knex: TenantScopedKnex,
  tenant: string,
  templateId: string,
  contractLineId: string,
  customRate?: number
): Promise<string> {
  const templateLine = await tenantScopedTable(knex, tenant, 'contract_template_lines')
    .where({ template_id: templateId, template_line_id: contractLineId })
    .first();

  if (templateLine) {
    await tenantScopedTable(knex, tenant, 'contract_template_lines')
      .where({ template_id: templateId, template_line_id: contractLineId })
      .update({
        custom_rate: customRate ?? templateLine.custom_rate ?? null,
        updated_at: knex.fn.now(),
      });
    return contractLineId;
  }

  const baseLine = await tenantScopedTable(knex, tenant, 'contract_lines')
    .where('contract_line_id', contractLineId)
    .first();

  if (!baseLine) {
    throw new Error(`Base contract line ${contractLineId} not found for template snapshot`);
  }

  const now = knex.fn.now();
  const existingTemplateLine = await tenantScopedTable(knex, tenant, 'contract_template_lines')
    .where('template_line_id', contractLineId)
    .first();

  const targetTemplateLineId = existingTemplateLine ? uuidv4() : contractLineId;
  const baseRecurringStorage = normalizeLiveRecurringStorage(baseLine);

  await tenantScopedTable(knex, tenant, 'contract_template_lines').insert({
    tenant,
    template_line_id: targetTemplateLineId,
    template_id: templateId,
    template_line_name: baseLine.contract_line_name,
    description: baseLine.description ?? null,
    billing_frequency: baseLine.billing_frequency,
    line_type: baseLine.contract_line_type ?? 'Fixed',
    service_category: baseLine.service_category ?? null,
    is_active: baseLine.is_active ?? true,
    enable_overtime: baseLine.enable_overtime ?? false,
    overtime_rate: baseLine.overtime_rate ?? null,
    overtime_threshold: baseLine.overtime_threshold ?? null,
    enable_after_hours_rate: baseLine.enable_after_hours_rate ?? false,
    after_hours_multiplier: baseLine.after_hours_multiplier ?? null,
    minimum_billable_time: null,
    round_up_to_nearest: null,
    created_at: baseLine.created_at ?? now,
    updated_at: now,
    custom_rate: customRate ?? baseLine.custom_rate ?? null,
    display_order: baseLine.display_order ?? 0,
    billing_timing: baseRecurringStorage.billing_timing,
    cadence_owner: baseRecurringStorage.cadence_owner,
  });

  return targetTemplateLineId;
}

// ---------------------------------------------------------------------------
// Template line -> live contract line (the ONE clone routine)
// ---------------------------------------------------------------------------

/**
 * Per-service edit applied while cloning. `rate` is cents in the contract's
 * currency and means, by line type: Fixed = the member's base rate, Hourly =
 * hourly rate, Usage = unit rate. `null` explicitly clears a rate (Fixed then
 * follows the catalog); `undefined` keeps the template/currency-resolved value.
 */
export interface TemplateLineServiceEdit {
  service_id: string;
  quantity?: number | null;
  rate?: number | null;
}

/**
 * Line-level edits the wizard applies on top of a faithful clone. Anything left
 * `undefined` is copied from the template unchanged.
 */
export interface TemplateLineEdits {
  line_name?: string;
  billing_frequency?: string;
  /** Fixed lines only; cents. `null` clears the line rate (line follows catalog). */
  fixed_base_rate?: number | null;
  minimum_billable_time?: number | null;
  round_up_to_nearest?: number | null;
  services?: TemplateLineServiceEdit[];
}

export interface CloneTemplateLineOptions {
  /** Explicit line rate in cents (the `addContractLine` API argument). */
  customRate?: number;
  /**
   * Contract currency. When set, a service the template carries no rate for is
   * resolved from the catalog in THIS currency only (mode default, then latest
   * effective `service_prices` row). The untagged legacy
   * `service_catalog.default_rate` is never consulted, so a missing price is
   * never silently filled with a USD amount.
   */
  currencyCode?: string;
  /** Wizard edits keyed by nothing but this line (the caller picks the line). */
  edits?: TemplateLineEdits;
  /** Overrides the template line's display order. */
  displayOrder?: number;
}

export interface UnpricedTemplateService {
  service_id: string;
  service_name: string;
}

export interface CloneTemplateLineResult {
  contract_line_id: string;
  /**
   * Services that ended up with no rate anywhere: none from the edit, the
   * template or the client-currency catalog, and (for fixed members) no line
   * rate and no `service_prices` row in the currency. Only populated when
   * `currencyCode` was supplied.
   */
  unpriced_services: UnpricedTemplateService[];
}

type ServicePricingMode = 'fixed' | 'hourly' | 'usage';

const positiveCentsOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric);
  return rounded > 0 ? rounded : null;
};

const nonNegativeCentsOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.round(numeric));
};

export interface CurrencyCatalogRates {
  /** `service_catalog_mode_defaults` rows for the line's billing mode. */
  modeDefaults: Map<string, number>;
  /** Newest `service_prices` row effective today, per service. */
  currentPrices: Map<string, number>;
  /**
   * Services with ANY `service_prices` row in the currency. This is what the
   * wizard's existing "has pricing in this currency" check accepts, and what a
   * Fixed member with no stored rate resolves against at billing time.
   */
  pricedServiceIds: Set<string>;
}

/**
 * Catalog rates for `serviceIds` in exactly `currencyCode`. Never reads the
 * currency-untagged legacy `service_catalog.default_rate`.
 */
export async function fetchCurrencyCatalogRates(
  knex: TenantScopedKnex,
  tenant: string,
  serviceIds: string[],
  mode: ServicePricingMode,
  currencyCode: string,
): Promise<CurrencyCatalogRates> {
  const modeDefaults = new Map<string, number>();
  const currentPrices = new Map<string, number>();
  const pricedServiceIds = new Set<string>();
  const unique = Array.from(new Set(serviceIds.filter(Boolean)));
  if (unique.length === 0) {
    return { modeDefaults, currentPrices, pricedServiceIds };
  }

  const priceRows = await tenantScopedTable(knex, tenant, 'service_prices')
    .where({ currency_code: currencyCode })
    .whereIn('service_id', unique)
    .select('service_id', 'rate', 'effective_date');
  const today = new Date().toISOString().slice(0, 10);
  const latestByService = new Map<string, { effective: string; rate: number }>();
  for (const row of priceRows as Array<{ service_id: string; rate: unknown; effective_date: unknown }>) {
    pricedServiceIds.add(row.service_id);
    const effective =
      row.effective_date instanceof Date
        ? row.effective_date.toISOString().slice(0, 10)
        : String(row.effective_date ?? '1970-01-01').slice(0, 10);
    const rate = positiveCentsOrNull(row.rate);
    if (effective > today || rate === null) continue;
    const current = latestByService.get(row.service_id);
    if (!current || effective > current.effective) {
      latestByService.set(row.service_id, { effective, rate });
    }
  }
  latestByService.forEach((value, serviceId) => currentPrices.set(serviceId, value.rate));

  const modeRows = await tenantScopedTable(knex, tenant, 'service_catalog_mode_defaults')
    .where({ billing_mode: mode, currency_code: currencyCode })
    .whereIn('service_id', unique)
    .select('service_id', 'rate');
  for (const row of modeRows as Array<{ service_id: string; rate: unknown }>) {
    const rate = positiveCentsOrNull(row.rate);
    if (rate !== null) modeDefaults.set(row.service_id, rate);
  }

  return { modeDefaults, currentPrices, pricedServiceIds };
}

/**
 * Clone one template line into a live contract line, copying EVERYTHING the
 * template stores: name, frequency, recurring timing, line rate, fixed config,
 * hourly/overtime/after-hours terms, every service with its per-service rate,
 * per-service hourly/usage/fixed configs, bucket pools and line defaults.
 *
 * This is the single template-to-contract clone. `addContractLine` and the
 * contract wizard both call it; do not grow a second routine.
 *
 * Rates are cents. Rate precedence per member: wizard edit > template value >
 * client-currency catalog (only when `options.currencyCode` is given). A rate
 * with no source is left unset (Fixed: `inherited`/null so it follows the
 * catalog; Hourly/Usage: stored as 0 because the column is NOT NULL) and is
 * reported in `unpriced_services` for the caller to reject or accept.
 *
 * Runs on the caller's transaction and touches only `tenant` rows. Usage tiers
 * are NOT cloned: templates have no tier storage (see draftSummary).
 */
// LEVERAGE: friction template-clone-substrate — this is the ONE faithful template->contract line clone (wizard + addContractLine). shared/billingClients/templateClone.ts, billing/lib/billing/utils/templateClone.ts and three other callers still run older divergent clones; they should call this or a layer beneath it.
export async function cloneTemplateLineToContract(
  trx: TenantScopedKnex,
  tenant: string,
  contractId: string,
  templateLineId: string,
  options: CloneTemplateLineOptions = {},
): Promise<CloneTemplateLineResult> {
  const templateLine = await tenantScopedTable(trx, tenant, 'contract_template_lines')
    .where('template_line_id', templateLineId)
    .first();

  if (!templateLine) {
    throw new Error(`Template contract line ${templateLineId} not found`);
  }

  const edits = options.edits ?? {};
  const lineType: string = templateLine.line_type ?? 'Fixed';
  const now = trx.fn.now();
  const newContractLineId = uuidv4();

  const templateFixedConfig = await tenantScopedTable(trx, tenant, 'contract_template_line_fixed_config')
    .where('template_line_id', templateLineId)
    .first();
  const templateServices = await tenantScopedTable(trx, tenant, 'contract_template_line_services')
    .where('template_line_id', templateLineId)
    .orderBy('display_order', 'asc');
  const templateConfigurations = await tenantScopedTable(trx, tenant, 'contract_template_line_service_configuration')
    .where('template_line_id', templateLineId);

  const serviceIds = templateServices.map((s: any) => s.service_id as string);
  const catalogRows = serviceIds.length
    ? await tenantScopedTable(trx, tenant, 'service_catalog')
        .whereIn('service_id', serviceIds)
        .select('service_id', 'service_name')
    : [];
  const serviceNameById = new Map<string, string>(
    (catalogRows as Array<{ service_id: string; service_name: string }>).map((r) => [r.service_id, r.service_name]),
  );

  const pricingMode: ServicePricingMode =
    lineType === 'Hourly' ? 'hourly' : lineType === 'Usage' ? 'usage' : 'fixed';
  const currencyRates = options.currencyCode
    ? await fetchCurrencyCatalogRates(trx, tenant, serviceIds, pricingMode, options.currencyCode)
    : null;

  const serviceEditById = new Map<string, TemplateLineServiceEdit>();
  for (const serviceEdit of edits.services ?? []) {
    if (serviceEdit?.service_id) serviceEditById.set(serviceEdit.service_id, serviceEdit);
  }

  // ----- line-level rate (Fixed) -------------------------------------------
  // Template authoring writes `fixed_base_rate ?? 0`, so 0 means "no line
  // rate", not a stored zero; only a positive number is a rate to carry over.
  const templateLineRate =
    positiveCentsOrNull(templateLine.custom_rate) ?? positiveCentsOrNull(templateFixedConfig?.base_rate);
  // undefined = nothing explicit; null = explicitly cleared (line follows catalog).
  let explicitLineRate: number | null | undefined;
  if (edits.fixed_base_rate !== undefined) {
    explicitLineRate = positiveCentsOrNull(edits.fixed_base_rate);
  } else if (options.customRate !== undefined) {
    explicitLineRate = nonNegativeCentsOrNull(options.customRate);
  }
  const effectiveLineRate: number | null =
    explicitLineRate !== undefined
      ? explicitLineRate
      : resolveClonedRate({
          explicitRate: null,
          templateRate: templateLineRate,
          templateBaseRate: null,
          // Templates carry no provenance label; a stored positive rate is an
          // intentional snapshot (custom), otherwise the line follows the catalog.
          templateProvenance: templateLineRate != null ? 'custom' : 'inherited',
        }).rateCents;

  const templateBillingCycleAlignment = resolveBillingCycleAlignmentForCompatibility({
    billingCycleAlignment: templateFixedConfig?.billing_cycle_alignment,
    enableProration: templateFixedConfig?.enable_proration,
  });
  const templateRecurringStorage = normalizeTemplateRecurringStorage({
    billing_timing: templateLine.billing_timing,
    cadence_owner: templateLine.cadence_owner,
  });

  const minimumBillableTime =
    edits.minimum_billable_time !== undefined ? edits.minimum_billable_time : templateLine.minimum_billable_time ?? null;
  const roundUpToNearest =
    edits.round_up_to_nearest !== undefined ? edits.round_up_to_nearest : templateLine.round_up_to_nearest ?? null;

  // Template-derived live lines copy recurring timing at clone time.
  // Later template edits are provenance only and must not retroactively rewrite
  // cadence_owner or billing_timing on already-created contract lines.
  await tenantScopedTable(trx, tenant, 'contract_lines').insert({
    tenant,
    contract_line_id: newContractLineId,
    contract_id: contractId,
    contract_line_name: edits.line_name?.trim() ? edits.line_name.trim() : templateLine.template_line_name,
    description: templateLine.description ?? null,
    billing_frequency: edits.billing_frequency ?? templateLine.billing_frequency,
    is_custom: false,
    contract_line_type: lineType,
    service_category: templateLine.service_category ?? null,
    is_active: templateLine.is_active ?? true,
    enable_overtime: templateLine.enable_overtime ?? false,
    overtime_rate: templateLine.overtime_rate ?? null,
    overtime_threshold: templateLine.overtime_threshold ?? null,
    enable_after_hours_rate: templateLine.enable_after_hours_rate ?? false,
    after_hours_multiplier: templateLine.after_hours_multiplier ?? null,
    minimum_billable_time: minimumBillableTime,
    round_up_to_nearest: roundUpToNearest,
    created_at: now,
    updated_at: now,
    is_template: false,
    custom_rate: effectiveLineRate,
    rate_provenance: effectiveLineRate === null ? 'inherited' : 'custom',
    display_order: options.displayOrder ?? templateLine.display_order ?? 0,
    billing_timing: templateRecurringStorage.billing_timing,
    cadence_owner: templateRecurringStorage.cadence_owner,
    enable_proration: templateFixedConfig?.enable_proration ?? false,
    billing_cycle_alignment: templateBillingCycleAlignment,
  });

  // Full pool config round-trip: clone the line's template pools (scope incl.
  // catch-all, membership, multipliers, schedule, after-hours rule) when the
  // template carries them, and skip the legacy per-config bucket clone below.
  const hasTemplatePools = await cloneTemplateLinePools(trx, tenant, templateLineId, newContractLineId);

  // Proportional shares of an edited line rate, so per-member rates stay
  // consistent with the line rate (same allocation the wizard uses).
  const lineRateEdited = edits.fixed_base_rate !== undefined && effectiveLineRate !== null;
  const anyServiceRateEdit = (edits.services ?? []).some((s) => s.rate !== undefined);
  const memberQuantity = (service: any): number => {
    const edit = serviceEditById.get(service.service_id);
    const quantity = edit?.quantity !== undefined ? edit.quantity : service.quantity;
    return quantity != null && Number(quantity) > 0 ? Number(quantity) : 1;
  };
  const totalQuantity = templateServices.reduce((sum: number, s: any) => sum + memberQuantity(s), 0) || 1;
  let allocated = 0;

  const unpricedServices: UnpricedTemplateService[] = [];

  for (const [index, service] of templateServices.entries()) {
    const edit = serviceEditById.get(service.service_id);
    const configurations = templateConfigurations.filter((c: any) => c.service_id === service.service_id);
    const configuration = configurations[0];

    const quantityEdited = edit?.quantity !== undefined;
    const quantity: number | null = quantityEdited
      ? edit!.quantity ?? null
      : service.quantity ?? configuration?.quantity ?? null;

    const typedByConfigId = new Map<string, { hourly?: any; usage?: any }>();
    for (const templateConfiguration of configurations as any[]) {
      typedByConfigId.set(templateConfiguration.config_id, {
        hourly: await tenantScopedTable(trx, tenant, 'contract_template_line_service_hourly_config')
          .where('config_id', templateConfiguration.config_id)
          .first(),
        usage: await tenantScopedTable(trx, tenant, 'contract_template_line_service_usage_config')
          .where('config_id', templateConfiguration.config_id)
          .first(),
      });
    }
    const primaryTyped = configuration ? typedByConfigId.get(configuration.config_id) : undefined;

    // ----- resolve the member rate ----------------------------------------
    const templateMemberRate =
      lineType === 'Hourly'
        ? positiveCentsOrNull(primaryTyped?.hourly?.hourly_rate) ??
          positiveCentsOrNull(configuration?.custom_rate) ??
          positiveCentsOrNull(service.custom_rate)
        : lineType === 'Usage'
          ? positiveCentsOrNull(primaryTyped?.usage?.base_rate) ??
            positiveCentsOrNull(configuration?.custom_rate) ??
            positiveCentsOrNull(service.custom_rate)
          : positiveCentsOrNull(configuration?.custom_rate) ?? positiveCentsOrNull(service.custom_rate);

    let memberRate: number | null;
    let rateFromEdit = false;
    if (edit && edit.rate !== undefined) {
      memberRate = edit.rate === null ? null : positiveCentsOrNull(edit.rate);
      rateFromEdit = true;
    } else if (lineType === 'Fixed' && lineRateEdited && !anyServiceRateEdit) {
      // The line rate was edited: re-split it across members by quantity.
      const share = memberQuantity(service) / totalQuantity;
      if (index === templateServices.length - 1) {
        memberRate = (effectiveLineRate as number) - allocated;
      } else {
        memberRate = Math.round((effectiveLineRate as number) * share);
        allocated += memberRate;
      }
      rateFromEdit = true;
    } else {
      memberRate = templateMemberRate;
    }
    if (memberRate === 0) memberRate = null;

    // Nothing from the edit or template: resolve in the contract currency only.
    // Fixed members snapshot just a configured fixed-mode default and otherwise
    // follow the catalog at billing time; Hourly/Usage members need a number
    // now, so they take the mode default, then the current catalog price.
    if (memberRate === null && !rateFromEdit && currencyRates) {
      memberRate =
        lineType === 'Fixed'
          ? currencyRates.modeDefaults.get(service.service_id) ?? null
          : currencyRates.modeDefaults.get(service.service_id) ??
            currencyRates.currentPrices.get(service.service_id) ??
            null;
    }

    if (currencyRates && memberRate === null) {
      const coveredByLineRate = lineType === 'Fixed' && effectiveLineRate !== null;
      const coveredByCatalog = lineType === 'Fixed' && currencyRates.pricedServiceIds.has(service.service_id);
      if (!coveredByLineRate && !coveredByCatalog) {
        unpricedServices.push({
          service_id: service.service_id,
          service_name: serviceNameById.get(service.service_id) ?? service.service_id,
        });
      }
    }

    // ----- contract_line_services -----------------------------------------
    await tenantScopedTable(trx, tenant, 'contract_line_services')
      .insert({
        tenant,
        contract_line_id: newContractLineId,
        service_id: service.service_id,
        quantity,
        custom_rate: memberRate,
      })
      .onConflict(['tenant', 'service_id', 'contract_line_id'])
      .merge({ quantity, custom_rate: memberRate });

    // ----- contract_line_service_configuration (+ typed configs) ----------
    // Every template configuration row is cloned.
    for (const templateConfiguration of configurations as any[]) {
      const newConfigId = uuidv4();
      const configurationType: string = templateConfiguration.configuration_type ?? lineType;
      const templateHourly = typedByConfigId.get(templateConfiguration.config_id)?.hourly;
      const templateUsage = typedByConfigId.get(templateConfiguration.config_id)?.usage;

      // Convention (matches wizard-authored lines): Fixed rates live in
      // contract_line_service_fixed_config.base_rate, Usage rates on the
      // configuration row (and usage config), Hourly rates on the hourly
      // config row.
      await tenantScopedTable(trx, tenant, 'contract_line_service_configuration').insert({
        tenant,
        config_id: newConfigId,
        contract_line_id: newContractLineId,
        service_id: service.service_id,
        configuration_type: configurationType,
        custom_rate: configurationType === 'Usage' ? memberRate : null,
        quantity,
        created_at: templateConfiguration.created_at ?? now,
        updated_at: now,
      });

      if (configurationType === 'Fixed') {
        await tenantScopedTable(trx, tenant, 'contract_line_service_fixed_config').insert({
          tenant,
          config_id: newConfigId,
          base_rate: memberRate,
          rate_provenance: memberRate === null ? 'inherited' : 'custom',
          pricing_basis: 'bundle',
          created_at: now,
          updated_at: now,
        });
      }

      const bucketConfig =
        !hasTemplatePools
          ? await tenantScopedTable(trx, tenant, 'contract_template_line_service_bucket_config')
              .where('config_id', templateConfiguration.config_id)
              .first()
          : undefined;

      if (bucketConfig) {
        // Legacy template (pre-dates pool tables): clone into the line-owned
        // pool tables (single member, 1x) rather than the frozen legacy
        // per-service bucket config.
        await tenantScopedTable(trx, tenant, 'contract_line_buckets').insert({
          tenant,
          bucket_id: newConfigId,
          contract_line_id: newContractLineId,
          bucket_name: null,
          total_minutes: bucketConfig.total_minutes,
          overage_rate: bucketConfig.overage_rate ?? 0,
          allow_rollover: bucketConfig.allow_rollover,
          billing_period: bucketConfig.billing_period,
          after_hours_multiplier: null,
          business_hours_schedule_id: null,
          covers_all_services: false,
          created_at: bucketConfig.created_at ?? now,
          updated_at: now,
        });
        await tenantScopedTable(trx, tenant, 'contract_line_bucket_services').insert({
          tenant,
          bucket_id: newConfigId,
          service_id: service.service_id,
          contract_line_id: newContractLineId,
          burn_multiplier: 1,
          created_at: bucketConfig.created_at ?? now,
          updated_at: now,
        });
      }

      if (configurationType === 'Hourly' || templateHourly) {
        const hourlyMinimum =
          edits.minimum_billable_time !== undefined
            ? edits.minimum_billable_time
            : templateHourly?.minimum_billable_time ?? templateLine.minimum_billable_time ?? 15;
        const hourlyRoundUp =
          edits.round_up_to_nearest !== undefined
            ? edits.round_up_to_nearest
            : templateHourly?.round_up_to_nearest ?? templateLine.round_up_to_nearest ?? 15;

        // Two live tables carry hourly state: `_hourly_configs` (plural) holds
        // the rate and billable-time rounding the engine reads; the singular
        // `_hourly_config` holds the overtime / after-hours terms. Writing only
        // the singular one is what used to drop the hourly rate on clone.
        await tenantScopedTable(trx, tenant, 'contract_line_service_hourly_configs').insert({
          tenant,
          config_id: newConfigId,
          hourly_rate: memberRate ?? 0,
          minimum_billable_time: hourlyMinimum ?? 0,
          round_up_to_nearest: hourlyRoundUp ?? 0,
          created_at: now,
          updated_at: now,
        });
        await tenantScopedTable(trx, tenant, 'contract_line_service_hourly_config').insert({
          tenant,
          config_id: newConfigId,
          minimum_billable_time: hourlyMinimum ?? 0,
          round_up_to_nearest: hourlyRoundUp ?? 0,
          enable_overtime: templateHourly?.enable_overtime ?? templateLine.enable_overtime ?? false,
          overtime_rate: templateHourly?.overtime_rate ?? templateLine.overtime_rate ?? null,
          overtime_threshold: templateHourly?.overtime_threshold ?? templateLine.overtime_threshold ?? null,
          enable_after_hours_rate:
            templateHourly?.enable_after_hours_rate ?? templateLine.enable_after_hours_rate ?? false,
          after_hours_multiplier:
            templateHourly?.after_hours_multiplier ?? templateLine.after_hours_multiplier ?? null,
          created_at: now,
          updated_at: now,
        });
      }

      if (configurationType === 'Usage' || templateUsage) {
        await tenantScopedTable(trx, tenant, 'contract_line_service_usage_config').insert({
          tenant,
          config_id: newConfigId,
          ...withUnitCode({
            unit_of_measure: templateUsage?.unit_of_measure,
            unit_code: templateUsage?.unit_code,
          }),
          enable_tiered_pricing: templateUsage?.enable_tiered_pricing ?? false,
          minimum_usage: templateUsage?.minimum_usage ?? 0,
          base_rate: memberRate,
          created_at: now,
          updated_at: now,
        });
      }
    }
  }

  const templateDefaults = await tenantScopedTable(trx, tenant, 'contract_template_line_defaults')
    .where('template_line_id', templateLineId);

  for (const def of templateDefaults) {
    await tenantScopedTable(trx, tenant, 'contract_line_service_defaults').insert({
      tenant,
      // Fresh id: default_id is unique per tenant, so reusing the template's id
      // made a second clone of the same template fail on the primary key.
      default_id: uuidv4(),
      contract_line_id: newContractLineId,
      service_id: def.service_id,
      line_type: def.line_type ?? null,
      default_tax_behavior: def.default_tax_behavior ?? null,
      metadata: def.metadata ?? null,
      created_at: def.created_at ?? now,
      updated_at: now,
    });
  }

  return { contract_line_id: newContractLineId, unpriced_services: unpricedServices };
}

// ---------------------------------------------------------------------------
// Per-line template view (what the client wizard shows before cloning)
// ---------------------------------------------------------------------------

export interface TemplateLineServiceView {
  service_id: string;
  service_name: string;
  item_kind: string | null;
  quantity: number | null;
  /** The rate the template stores for this member (cents), if any. */
  template_rate: number | null;
  /** Catalog rate in the client's currency (cents), if any; never USD-by-default. */
  currency_rate: number | null;
  /** Any `service_prices` row exists for this service in the client's currency. */
  has_currency_price: boolean;
  unit_of_measure: string | null;
}

export interface TemplateLineView {
  template_line_id: string;
  line_name: string;
  line_type: string;
  billing_frequency: string;
  cadence_owner: string;
  billing_timing: string;
  display_order: number;
  /** Fixed lines: the line rate the clone will carry over (cents), else null. */
  fixed_base_rate: number | null;
  enable_proration: boolean;
  minimum_billable_time: number | null;
  round_up_to_nearest: number | null;
  bucket_pool_count: number;
  services: TemplateLineServiceView[];
}

/**
 * Read-only per-line view of a template, with rates resolved for
 * `currencyCode`. Mirrors the rate sources `cloneTemplateLineToContract` uses so
 * the wizard shows what the clone will produce.
 */
// LEVERAGE: pattern template-member-rate — the "template value, else client-currency catalog" member-rate decision is written here and in cloneTemplateLineToContract; extract one resolver.
export async function fetchTemplateLineViews(
  knex: TenantScopedKnex,
  tenant: string,
  templateId: string,
  currencyCode: string,
): Promise<TemplateLineView[]> {
  const lines = await tenantScopedTable(knex, tenant, 'contract_template_lines')
    .where('template_id', templateId)
    .orderBy('display_order', 'asc')
    .orderBy('created_at', 'asc');

  const views: TemplateLineView[] = [];
  for (const line of lines as any[]) {
    const lineType: string = line.line_type ?? 'Fixed';
    const fixedConfig = await tenantScopedTable(knex, tenant, 'contract_template_line_fixed_config')
      .where('template_line_id', line.template_line_id)
      .first();
    const services = await tenantScopedTable(knex, tenant, 'contract_template_line_services')
      .where('template_line_id', line.template_line_id)
      .orderBy('display_order', 'asc');
    const configurations = await tenantScopedTable(knex, tenant, 'contract_template_line_service_configuration')
      .where('template_line_id', line.template_line_id);
    const serviceIds = (services as any[]).map((service) => service.service_id as string);
    const catalog = serviceIds.length
      ? await tenantScopedTable(knex, tenant, 'service_catalog')
          .whereIn('service_id', serviceIds)
          .select('service_id', 'service_name', 'item_kind', 'unit_of_measure')
      : [];
    const catalogById = new Map<string, any>((catalog as any[]).map((row) => [row.service_id, row]));
    const mode: ServicePricingMode = lineType === 'Hourly' ? 'hourly' : lineType === 'Usage' ? 'usage' : 'fixed';
    const rates = await fetchCurrencyCatalogRates(knex, tenant, serviceIds, mode, currencyCode);

    const memberViews: TemplateLineServiceView[] = [];
    for (const service of services as any[]) {
      const configuration = (configurations as any[]).find((c) => c.service_id === service.service_id);
      const hourly = configuration && lineType === 'Hourly'
        ? await tenantScopedTable(knex, tenant, 'contract_template_line_service_hourly_config')
            .where('config_id', configuration.config_id)
            .first()
        : undefined;
      const usage = configuration && lineType === 'Usage'
        ? await tenantScopedTable(knex, tenant, 'contract_template_line_service_usage_config')
            .where('config_id', configuration.config_id)
            .first()
        : undefined;
      const templateRate =
        lineType === 'Hourly'
          ? positiveCentsOrNull(hourly?.hourly_rate) ??
            positiveCentsOrNull(configuration?.custom_rate) ??
            positiveCentsOrNull(service.custom_rate)
          : lineType === 'Usage'
            ? positiveCentsOrNull(usage?.base_rate) ??
              positiveCentsOrNull(configuration?.custom_rate) ??
              positiveCentsOrNull(service.custom_rate)
            : positiveCentsOrNull(configuration?.custom_rate) ?? positiveCentsOrNull(service.custom_rate);
      const currencyRate =
        lineType === 'Fixed'
          ? rates.modeDefaults.get(service.service_id) ?? null
          : rates.modeDefaults.get(service.service_id) ?? rates.currentPrices.get(service.service_id) ?? null;
      const catalogRow = catalogById.get(service.service_id);
      memberViews.push({
        service_id: service.service_id,
        service_name: catalogRow?.service_name ?? service.service_id,
        item_kind: catalogRow?.item_kind ?? null,
        quantity: service.quantity ?? configuration?.quantity ?? null,
        template_rate: templateRate,
        currency_rate: currencyRate,
        has_currency_price: rates.pricedServiceIds.has(service.service_id) || currencyRate !== null,
        unit_of_measure: usage?.unit_of_measure ?? catalogRow?.unit_of_measure ?? null,
      });
    }

    const poolCountRow = await tenantScopedTable(knex, tenant, 'contract_template_line_buckets')
      .where('template_line_id', line.template_line_id)
      .count<{ count: string }[]>({ count: '*' })
      .first();
    const recurring = normalizeTemplateRecurringStorage({
      billing_timing: line.billing_timing,
      cadence_owner: line.cadence_owner,
    });

    views.push({
      template_line_id: line.template_line_id,
      line_name: line.template_line_name,
      line_type: lineType,
      billing_frequency: line.billing_frequency,
      cadence_owner: recurring.cadence_owner,
      billing_timing: recurring.billing_timing,
      display_order: line.display_order ?? 0,
      fixed_base_rate: positiveCentsOrNull(line.custom_rate) ?? positiveCentsOrNull(fixedConfig?.base_rate),
      enable_proration: fixedConfig?.enable_proration ?? false,
      minimum_billable_time: line.minimum_billable_time ?? null,
      round_up_to_nearest: line.round_up_to_nearest ?? null,
      bucket_pool_count: Number(poolCountRow?.count ?? 0),
      services: memberViews,
    });
  }

  return views;
}

export async function addContractLine(
  trx: TenantScopedKnex,
  tenant: string,
  contractId: string,
  contractLineId: string,
  customRate?: number
): Promise<IContractLineMapping> {
  const template = await isTemplateContract(trx, tenant, contractId);

  if (template) {
    const effectiveLineId = await ensureTemplateLineSnapshot(trx, tenant, contractId, contractLineId, customRate);

    const row = await tenantScopedTable(trx, tenant, 'contract_template_lines')
      .where({ template_id: contractId, template_line_id: effectiveLineId })
      .first([
        'tenant',
        'template_id as contract_id',
        'template_line_id as contract_line_id',
        'display_order',
        'custom_rate',
        'billing_timing',
        'cadence_owner',
        'created_at',
      ]);

    return mapContractLineRow(row);
  }

  // Resolve un-rated members in the contract's own currency. Unlike the wizard,
  // this API has never rejected an un-priced member, so the unpriced list is
  // ignored here and such members are simply left unset.
  const contractRow = await tenantScopedTable(trx, tenant, 'contracts')
    .where('contract_id', contractId)
    .first('currency_code');
  const { contract_line_id: newContractLineId } = await cloneTemplateLineToContract(
    trx,
    tenant,
    contractId,
    contractLineId,
    { customRate, currencyCode: contractRow?.currency_code ?? undefined },
  );

  const row = await tenantScopedTable(trx, tenant, 'contract_lines')
    .where({ contract_id: contractId, contract_line_id: newContractLineId })
    .first([
      'tenant',
      'contract_id',
      'contract_line_id',
      'display_order',
      'custom_rate',
      'billing_timing',
      'cadence_owner',
      'location_id',
      'created_at',
    ]);

  return mapContractLineRow(row);
}

export async function removeContractLine(
  knex: TenantScopedKnex,
  tenant: string,
  contractId: string,
  contractLineId: string
): Promise<void> {
  const template = await isTemplateContract(knex, tenant, contractId);

  if (template) {
    await tenantScopedTable(knex, tenant, 'contract_template_lines')
      .where({ template_id: contractId, template_line_id: contractLineId })
      .delete();
    return;
  }

  await tenantScopedTable(knex, tenant, 'contract_lines')
    .where({ contract_id: contractId, contract_line_id: contractLineId })
    .delete();
}

export async function updateContractLine(
  knex: TenantScopedKnex,
  tenant: string,
  contractId: string,
  contractLineId: string,
  updateData: Partial<IContractLineMapping>
): Promise<IContractLineMapping> {
  const template = await isTemplateContract(knex, tenant, contractId);
  const payload = { ...updateData };

  // A partial update that omits custom_rate must not null it: nulling a
  // negotiated rate silently destroys it, and the provenance CHECK would
  // reject the inconsistent state anyway. Only touch the rate when the caller
  // actually supplied one, and relabel provenance to match.
  const rateUpdate =
    payload.custom_rate === undefined
      ? {}
      : {
          custom_rate: payload.custom_rate,
          rate_provenance: payload.custom_rate === null ? "inherited" : "custom",
        };

  if (template) {
    const existingTemplateLine = await tenantScopedTable(knex, tenant, 'contract_template_lines')
      .where({ template_id: contractId, template_line_id: contractLineId })
      .first(['cadence_owner', 'billing_timing']);
    const recurringAuthoringPolicy = resolveRecurringAuthoringPolicy({
      cadenceOwner: payload.cadence_owner,
      fallbackCadenceOwner: existingTemplateLine?.cadence_owner ?? DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER,
      billingTiming: payload.billing_timing,
      fallbackBillingTiming: existingTemplateLine?.billing_timing,
    });

    await tenantScopedTable(knex, tenant, 'contract_template_lines')
      .where({ template_id: contractId, template_line_id: contractLineId })
      .update({
        ...(payload.custom_rate === undefined
          ? {}
          : { custom_rate: payload.custom_rate }),
        display_order: payload.display_order ?? undefined,
        billing_timing: recurringAuthoringPolicy.billingTiming,
        cadence_owner: recurringAuthoringPolicy.cadenceOwner,
        updated_at: knex.fn.now(),
      });

    const row = await tenantScopedTable(knex, tenant, 'contract_template_lines')
      .where({ template_id: contractId, template_line_id: contractLineId })
      .first([
        'tenant',
        'template_id as contract_id',
        'template_line_id as contract_line_id',
        'display_order',
        'custom_rate',
        'billing_timing',
        'cadence_owner',
        'created_at',
      ]);
    return mapContractLineRow(row);
  }

  const existingLine = await tenantScopedTable(knex, tenant, 'contract_lines')
    .where({ contract_id: contractId, contract_line_id: contractLineId })
    .first(['cadence_owner', 'billing_timing']);
  const recurringAuthoringPolicy = resolveRecurringAuthoringPolicy({
    cadenceOwner: payload.cadence_owner,
    fallbackCadenceOwner: existingLine?.cadence_owner ?? DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER,
    billingTiming: payload.billing_timing,
    fallbackBillingTiming: existingLine?.billing_timing,
  });

  await tenantScopedTable(knex, tenant, 'contract_lines')
    .where({ contract_id: contractId, contract_line_id: contractLineId })
    .update({
      ...rateUpdate,
      display_order: payload.display_order ?? undefined,
      billing_timing: recurringAuthoringPolicy.billingTiming,
      cadence_owner: recurringAuthoringPolicy.cadenceOwner,
      updated_at: knex.fn.now(),
    });

  const row = await tenantScopedTable(knex, tenant, 'contract_lines')
    .where({ contract_id: contractId, contract_line_id: contractLineId })
    .first([
      'tenant',
      'contract_id',
      'contract_line_id',
      'display_order',
      'custom_rate',
      'billing_timing',
      'cadence_owner',
      'location_id',
      'created_at',
    ]);
  return mapContractLineRow(row);
}

export async function fetchContractLineById(
  knex: TenantScopedKnex,
  tenant: string,
  contractLineId: string
): Promise<IContractLine | undefined> {
  const row = await tenantScopedTable(knex, tenant, 'contract_lines')
    .where('contract_line_id', contractLineId)
    .first();

  if (!row) {
    return undefined;
  }

  return normalizeLiveRecurringStorage(row);
}

export async function updateContractLineRate(
  knex: TenantScopedKnex,
  tenant: string,
  contractId: string,
  contractLineId: string,
  rate: number | null,
  billingTiming?: 'arrears' | 'advance'
): Promise<void> {
  const now = knex.fn.now();
  const template = await isTemplateContract(knex, tenant, contractId);

  if (template) {
    const existingTemplateLine = await tenantScopedTable(knex, tenant, 'contract_template_lines')
      .where({ template_id: contractId, template_line_id: contractLineId })
      .first(['billing_timing', 'cadence_owner']);
    const recurringAuthoringPolicy = resolveRecurringAuthoringPolicy({
      fallbackCadenceOwner: existingTemplateLine?.cadence_owner ?? DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER,
      billingTiming,
      fallbackBillingTiming: existingTemplateLine?.billing_timing,
    });

    await tenantScopedTable(knex, tenant, 'contract_template_lines')
      .where({ template_id: contractId, template_line_id: contractLineId })
      .update({
        custom_rate: rate,
        billing_timing: recurringAuthoringPolicy.billingTiming,
        updated_at: now,
      });
    return;
  }

  const existingLine = await tenantScopedTable(knex, tenant, 'contract_lines')
    .where({ contract_id: contractId, contract_line_id: contractLineId })
    .first(['billing_timing', 'cadence_owner']);
  const recurringAuthoringPolicy = resolveRecurringAuthoringPolicy({
    fallbackCadenceOwner: existingLine?.cadence_owner ?? DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER,
    billingTiming,
    fallbackBillingTiming: existingLine?.billing_timing,
  });

    await tenantScopedTable(knex, tenant, 'contract_lines')
      .where({ contract_id: contractId, contract_line_id: contractLineId })
      .update({
        custom_rate: rate,
        rate_provenance: rate === null ? 'inherited' : 'custom',
        billing_timing: recurringAuthoringPolicy.billingTiming,
        updated_at: now,
      });
}
