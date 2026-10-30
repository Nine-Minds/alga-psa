'use server';


import { isSupportedCurrency } from '@alga-psa/core/formatters';
import { resolveUnitOfMeasure, withUnitCode } from '@alga-psa/core/unitOfMeasure';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth/withAuth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { actionError, permissionError } from '@alga-psa/ui/lib/errorHandling';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { emitDateDomainEventOnce, normalizeDateDomainKeyDate } from '@alga-psa/event-bus/workflow/dateDomainEvents';
import {
  buildContractCreatedPayload,
  buildContractRenewalUpcomingPayload,
  computeContractRenewalUpcoming,
} from '@alga-psa/workflow-streams';
import { resolveBillingCycleAlignmentForCompatibility } from '@shared/billingClients/billingCycleAlignmentCompatibility';
import {
  DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER,
  resolveRecurringAuthoringPolicy,
} from '@shared/billingClients/recurringAuthoringPolicy';
import { createClientContractAssignment } from '@alga-psa/shared/billingClients';
import {
  listTemplateCurrencies,
  resolveTemplateAmounts,
  writeTemplatePriceSet,
} from '@alga-psa/shared/billingClients/templateAmounts';
import { cloneTemplateDefaultDiscounts } from '../lib/billing/utils/templateClone';
import {
  toStoredDiscountValue,
  validateDiscountInput,
} from '../lib/billing/discountAuthoring';


import ContractLine from '../models/contractLine';
import ContractLineFixedConfig from '../models/contractLineFixedConfig';
import { ContractLineServiceConfigurationService } from '../services/contractLineServiceConfigurationService';
import { getContractLineServicesWithConfigurations } from './contractLineServiceActions';

import {
  cloneTemplateLineToContract,
  ensureTemplateLineSnapshot,
  fetchCurrencyCatalogRates,
  fetchDetailedContractLines,
  fetchTemplateLineViews,
  type TemplateLineEdits,
  type TemplateLineView,
} from '../repositories/contractLineRepository';
import {
  allocateBundleBaseRate,
  getFixedServiceBasisIssue,
  hasBundleFixedService,
  isUnitFixedService,
} from '../lib/fixedServiceBasis';
import {
  diffRecurringShapes,
  recurringShapeFromStoredLines,
  recurringShapeFromWizard,
  type StoredRecurringLine,
} from '../lib/contractRecurringShape';
import { getContractMonthlyFixedValuesByContract } from '@alga-psa/shared/billingClients/contractMonthlyValue';
import {
  CadenceOwner,
  ContractWizardFixedLine,
  ContractWizardFixedService,
  FixedPricingBasis,
  IContractLineServiceBucketConfig,
  IContractLineServiceFixedConfig,
  IContractLineServiceHourlyConfig,
  IContractLineServiceUsageConfig,
} from '@alga-psa/types';
import {
  BucketOverlayInput,
  upsertBucketOverlayInTransaction
} from './bucketOverlayActions';
import { createBucketPoolInTransaction } from './bucketPoolActions';
import { syncRecurringServicePeriodsForContract } from './recurringServicePeriodSync';
import { syncPrepaidBlockIssuancesForContract } from '../services/prepaidBlockIssuanceSync';
import {
  upsertContractLinePrepaidBlockInTransaction,
  upsertTemplateLinePrepaidBlockInTransaction,
  type PrepaidBlockConfigInput,
} from '../services/prepaidBlockConfigService';
import {
  contractWizardActionErrorFrom,
  fixedLineNoServiceMessage,
  CONTRACT_DISCOUNT_PREFIX,
  RecurringTotalChangeRequiresConfirmation,
  currencyPricingMissingError,
  templateAmountsMissingError,
  type ContractWizardActionError,
  type RecurringTotalChangeConfirmation,
} from './contractWizardActionErrors';

export type { ContractWizardActionError } from './contractWizardActionErrors';

/**
 * Reject fixed-service inputs that cannot be stored faithfully. A unit-priced
 * member without a whole quantity >= 0 and an explicit unit rate would
 * otherwise silently fall back to bundle or bill nothing.
 */
function assertFixedServiceBasisInputs(
  services: Array<{ service_id: string; service_name?: string; pricing_basis?: FixedPricingBasis | string | null; quantity?: number | null; unit_rate?: number | null }>,
  options: { requireUnitRate?: boolean } = {},
): void {
  for (const service of services) {
    if (service.pricing_basis != null && service.pricing_basis !== 'bundle' && service.pricing_basis !== 'unit') {
      throw new Error('Choose bundle or recurring unit pricing.');
    }
    const issue = getFixedServiceBasisIssue(service, options);
    const label = service.service_name ? `"${service.service_name}"` : service.service_id;
    if (issue === 'quantity_invalid') {
      throw new Error(`Quantity for ${label} must be zero or greater.`);
    }
    if (issue === 'unit_quantity_not_whole') {
      throw new Error(`Recurring quantity for ${label} must be a whole number.`);
    }
    if (issue === 'unit_rate_required') {
      throw new Error(`Enter a unit rate for recurring service ${label}.`);
    }
  }
}

// LEVERAGE: friction wizard-fixed-legacy-input — remove once callers send fixed_lines
/**
 * The one place the legacy single-line fixed shape (`fixed_services` +
 * `fixed_base_rate` + `fixed_billing_frequency`) is turned into `fixed_lines`.
 * Sending both shapes is ambiguous and rejected.
 */
function normalizeFixedLinesInput(submission: ClientContractWizardSubmission): ContractWizardFixedLine[] {
  const legacyServices = (Array.isArray(submission.fixed_services) ? submission.fixed_services : []).filter(
    (service) => service?.service_id,
  );
  const hasLegacy =
    legacyServices.length > 0 || submission.fixed_base_rate != null || submission.fixed_billing_frequency != null;
  const lines = Array.isArray(submission.fixed_lines) ? submission.fixed_lines : [];

  if (lines.length > 0 && hasLegacy) {
    throw new Error('Submit either fixed_lines or the legacy fixed_services/fixed_base_rate fields, not both');
  }
  if (lines.length > 0) {
    return lines.map((line) => ({
      ...line,
      services: (Array.isArray(line.services) ? line.services : []).filter((service) => service?.service_id),
    }));
  }
  if (legacyServices.length === 0) return [];

  return [
    {
      line_key: 'legacy-fixed-line',
      enable_proration: submission.enable_proration,
      billing_frequency: submission.fixed_billing_frequency,
      base_rate: submission.fixed_base_rate ?? null,
      services: legacyServices.map((service) => ({ ...service, pricing_basis: service.pricing_basis ?? 'bundle' })),
    },
  ];
}

function resolveFixedLineName(
  contractName: string,
  line: ContractWizardFixedLine,
  index: number,
  lineCount: number,
): string {
  const explicit = line.contract_line_name?.trim();
  if (explicit) return explicit;
  const base = `${contractName} - Fixed Fee`;
  return lineCount > 1 ? `${base} (${index + 1})` : base;
}

/**
 * Writes one fixed line's service members (membership row + configuration).
 * The bundle base rate is shared across THIS line's bundle members only; unit
 * members bill quantity × unit rate on their own and take no share.
 */
async function writeFixedLineMembers(
  trx: Knex.Transaction,
  tenant: string,
  configService: ContractLineServiceConfigurationService,
  lineId: string,
  line: ContractWizardFixedLine,
  fixedModeDefaultsByServiceId: Map<string, number>,
): Promise<{ bundleLineBaseRate: number | null }> {
  const services = line.services;
  const lineHasBundleMember = hasBundleFixedService(services);
  const bundleLineBaseRate = lineHasBundleMember ? (line.base_rate ?? null) : null;
  const bundleShares = bundleLineBaseRate ? allocateBundleBaseRate(services, bundleLineBaseRate) : null;

  for (const [index, service] of services.entries()) {
    const isUnit = isUnitFixedService(service);
    // A unit quantity of zero is a stored zero — never defaulted to 1.
    const quantity = isUnit ? Number(service.quantity) : (service.quantity ?? 1);

    await tenantDb(trx, tenant).table('contract_line_services').insert({
      tenant,
      contract_line_id: lineId,
      service_id: service.service_id,
    });

    if (isUnit) {
      // Same creation path as CreateCustomContractLineDialog: the unit rate
      // is the member's own explicit (custom) fixed base_rate, and later
      // quantity/rate edits are routed through the revision service.
      await configService.createConfiguration(
        {
          contract_line_id: lineId,
          service_id: service.service_id,
          configuration_type: 'Fixed',
          quantity,
          tenant,
          custom_rate: undefined,
        },
        {
          pricing_basis: 'unit',
          // A seat rate is per unit. The fixed-config model derives the pair and
          // provenance: a null rate is catalog-priced (inherited) with no basis.
          base_rate: service.unit_rate ?? null,
          base_rate_basis: 'per_unit',
        },
      );
      continue;
    }

    // The operator's explicit rate is a snapshot (`custom`); absent one the
    // member is left rate-less (`inherited`) so a later catalog change
    // reaches it. Snapshotting the catalog here would shadow it forever.
    let serviceBaseRate: number | null = null;
    let serviceBaseProvenance: 'custom' | 'inherited' = 'inherited';
    // What the stored number means: a slice of the bundle fee, or a unit price.
    let serviceBaseBasis: 'per_unit' | 'share' = 'per_unit';
    if (bundleShares) {
      serviceBaseProvenance = 'custom';
      serviceBaseRate = bundleShares[index];
      serviceBaseBasis = 'share';
    } else {
      // A configured fixed-mode default is a chosen rate for this service,
      // and the rate resolver does not read that table — so it must be
      // preserved as a custom member rate or it is silently lost. The
      // legacy currency-untagged catalog `default_rate` is deliberately NOT
      // snapshotted: absent a mode default the line follows the effective
      // `service_prices` catalog.
      const modeDefault = firstPositiveRateInCents(fixedModeDefaultsByServiceId.get(service.service_id));
      if (modeDefault !== undefined) {
        serviceBaseRate = modeDefault;
        serviceBaseProvenance = 'custom';
        serviceBaseBasis = 'per_unit';
      }
    }

    await configService.createConfiguration(
      {
        contract_line_id: lineId,
        service_id: service.service_id,
        configuration_type: 'Fixed',
        quantity,
        tenant,
        custom_rate: undefined,
      },
      serviceBaseRate === null
        ? { base_rate: null, rate_provenance: serviceBaseProvenance }
        : { base_rate: serviceBaseRate, base_rate_basis: serviceBaseBasis, rate_provenance: serviceBaseProvenance },
    );
  }

  return { bundleLineBaseRate };
}

// ---------------------- Template wizard types ----------------------

type TemplateFixedServiceInput = {
  service_id: string;
  service_name?: string;
  quantity?: number;
  /** Absent means 'bundle' (the historical fixed-fee semantics). */
  pricing_basis?: FixedPricingBasis;
  /** Unit rate in minor units. Only meaningful (and required) for 'unit'. */
  unit_rate?: number | null;
};

type TemplateProductServiceInput = {
  service_id: string;
  service_name?: string;
  quantity?: number;
};

type TemplateHourlyServiceInput = {
  service_id: string;
  service_name?: string;
  hourly_rate?: number;
  bucket_overlay?: BucketOverlayInput | null;
};

type TemplateUsageServiceInput = {
  service_id: string;
  service_name?: string;
  unit_rate?: number;
  unit_of_measure?: string;
  bucket_overlay?: BucketOverlayInput | null;
};

export type ContractTemplateWizardSubmission = {
  contract_name: string;
  description?: string;
  billing_frequency?: string;
  cadence_owner?: CadenceOwner;
  billing_timing?: 'arrears' | 'advance';
  /** The template's base currency (ISO 4217). Amounts the wizard writes are in this currency. */
  currency_code: string;
  fixed_services: TemplateFixedServiceInput[];
  product_services?: TemplateProductServiceInput[];
  hourly_services?: TemplateHourlyServiceInput[];
  usage_services?: TemplateUsageServiceInput[];
  minimum_billable_time?: number;
  /** One extra Hourly template line (plus currency-neutral block config) per entry. */
  prepaid_block_lines?: TemplatePrepaidBlockLineInput[];
  round_up_to_nearest?: number;
  fixed_base_rate?: number;
  enable_proration?: boolean;
};

type TemplateOption = {
  contract_id: string;
  contract_name: string;
  contract_description?: string | null;
  billing_frequency?: string | null;
  /** The template's base currency. */
  currency_code: string;
  /** Currencies other than the base that have a saved price set. */
  price_set_currencies: string[];
  /** Subset of `price_set_currencies` missing at least one required amount. */
  incomplete_set_currencies: string[];
};

// ---------------------- Client wizard types ----------------------

/** Legacy single-line fixed member input (pricing_basis optional = 'bundle'). */
type LegacyFixedServiceInput = Omit<ContractWizardFixedService, 'pricing_basis'> & {
  pricing_basis?: FixedPricingBasis;
};

type ClientProductServiceInput = {
  service_id: string;
  service_name?: string;
  source_template_line_id?: string;
  quantity: number;
  /** Optional per-unit override in cents (contract currency). */
  custom_rate?: number;
};

type ClientHourlyServiceInput = {
  service_id: string;
  service_name?: string;
  source_template_line_id?: string;
  hourly_rate?: number;
  bucket_overlay?: BucketOverlayInput | null;
};

type ClientUsageServiceInput = {
  service_id: string;
  service_name?: string;
  source_template_line_id?: string;
  unit_rate?: number;
  unit_of_measure?: string;
  bucket_overlay?: BucketOverlayInput | null;
};

/**
 * One Prepaid Block line authored in the wizard: an extra Hourly line plus its block config.
 * `hourly_rate` is in contract-currency minor units (the overage rate, which must be above zero).
 */
export type ClientPrepaidBlockLineInput = {
  name?: string;
  services: Array<{ service_id: string; service_name?: string; hourly_rate?: number }>;
  block: PrepaidBlockConfigInput;
};

/** Template-wizard Prepaid Block line; template rates are optional and currency-neutral. */
export type TemplatePrepaidBlockLineInput = {
  name?: string;
  services: Array<{ service_id: string; service_name?: string; hourly_rate?: number }>;
  block: PrepaidBlockConfigInput;
};

export type ClientContractWizardSubmission = {
  /**
   * When provided, updates this existing draft contract instead of creating a new one.
   */
  contract_id?: string;
  contract_name: string;
  description?: string;
  client_id: string;
  /**
   * Billing profile this contract bills to (step 3 of the attribution chain).
   * Omitted / null keeps the client-default fallback.
   */
  billing_profile_id?: string | null;
  start_date: string;
  renewal_mode?: 'none' | 'manual' | 'auto';
  notice_period_days?: number;
  renewal_term_months?: number;
  use_tenant_renewal_defaults?: boolean;
  cadence_owner?: CadenceOwner;
  billing_timing?: 'arrears' | 'advance';
  billing_frequency?: string;
  currency_code: string;
  end_date?: string;
  po_required?: boolean;
  po_number?: string;
  po_amount?: number;
  /** One entry per recurring Fixed contract line. Preferred shape. */
  fixed_lines?: ContractWizardFixedLine[];
  /**
   * @deprecated Legacy single-line fixed shape for non-wizard callers; turned into exactly one
   * line by `normalizeFixedLinesInput`. Sending it together with `fixed_lines` is rejected.
   */
  fixed_services?: LegacyFixedServiceInput[];
  /** @deprecated See `fixed_services`. */
  fixed_base_rate?: number;
  /** @deprecated See `fixed_services`. */
  fixed_billing_frequency?: string;
  /** Contract-level proration; applies to the products line and to legacy-shape fixed input. */
  enable_proration: boolean;
  /**
   * Acknowledges a server-computed monthly recurring change for an existing draft. Valid only
   * when it equals the draft's stored monthly value at the time of the rebuild.
   */
  recurring_change_ack?: { baseline_monthly_cents: number };
  product_services?: ClientProductServiceInput[];
  /** The products line's own timing; unset inherits `billing_timing` (same rule as a fixed line's `billing_timing`). */
  product_billing_timing?: 'arrears' | 'advance';
  hourly_services?: ClientHourlyServiceInput[];
  hourly_billing_frequency?: string;
  usage_services?: ClientUsageServiceInput[];
  usage_billing_frequency?: string;
  minimum_billable_time?: number;
  round_up_to_nearest?: number;
  /** One extra Hourly line (plus block config) per entry; ignored when cloning a template. */
  prepaid_block_lines?: ClientPrepaidBlockLineInput[];
  /**
   * Published template to clone. When set the server clones every template line
   * (services, rates, configs, pools, defaults) inside the same transaction and
   * records the template on the client contract; the flat `*_services` arrays
   * and `bucket_pools` are ignored, and `template_lines` carries per-line edits.
   */
  template_id?: string;
  template_lines?: ClientTemplateLineEditInput[];
  /**
   * Template mode only. Persist the amounts this contract was created with as the
   * template's price set for the contract currency (adds the missing slots of a
   * partial set). Requires billing:update (re-checked server-side; a missing
   * permission rejects the whole request). Ignored when the template's own
   * currency is the contract currency.
   */
  save_template_amounts?: boolean;
  /**
   * Flag-on line-level bucket pools (weighted-burn model). Each draft carries
   * the line key it belongs to ('hourly' | 'usage'); pools are materialized
   * after the corresponding wizard line is created.
   */
  bucket_pools?: ClientBucketPoolDraftInput[];
  /**
   * Contract-wide automatic discounts authored in the wizard. Each becomes one
   * independently owned discount definition attached to the new client
   * contract. Ignored for a draft save: a draft holds no standing terms.
   */
  discounts?: ClientContractWizardDiscountInput[];
};

/**
 * One wizard-authored contract-wide discount. Values are in authoring units —
 * percent units (`10` = 10%) or decimal currency (`50` = $50.00) — and are
 * converted to the `discounts.value` convention by `toStoredDiscountValue`.
 */
export type ClientContractWizardDiscountInput = {
  discount_name: string;
  discount_type: 'percentage' | 'fixed';
  value: number;
  start_date: string;
  end_date?: string | null;
};

/** Flag-on wizard bucket pool draft (line-keyed; see ContractWizard's BucketPoolDraft). */
export type ClientBucketPoolDraftInput = {
  line_key?: 'hourly' | 'usage';
  bucket_name?: string | null;
  total_minutes: number;
  overage_rate: number;
  allow_rollover: boolean;
  covers_all_services?: boolean;
  after_hours_multiplier?: number | null;
  business_hours_schedule_id?: string | null;
  members: Array<{ service_id: string; burn_multiplier: number }>;
};

/**
 * Per-line edits the client wizard sends for a template-derived contract. The
 * server clones EVERY template line and then applies the edit for the matching
 * `template_line_id`; lines are never merged by type.
 */
export type ClientTemplateLineEditInput = TemplateLineEdits & {
  template_line_id: string;
};

/**
 * What the client wizard shows for a template: the template's lines one by one,
 * with member rates resolved for the client's currency. Replaces the old
 * flattened one-line-per-type snapshot, which collapsed same-type lines.
 */
export type ClientTemplateLinesView = {
  template_id: string;
  contract_name?: string;
  description?: string | null;
  billing_frequency?: string | null;
  /** The client's contract currency the rates below are resolved in. */
  currency_code: string;
  /** The template's base currency (what `template_amount` values are in). */
  template_currency: string;
  /** Where `amount` values come from: the base, a saved price set, or nowhere (fallback). */
  amount_source: 'base' | 'price_set' | 'none';
  /** billing:update, computed server-side; gates the "save to template" option. */
  can_save_template_amounts: boolean;
  lines: TemplateLineView[];
};

export type ContractWizardResult = {
  contract_id: string;
  contract_line_id?: string;
  contract_line_ids?: string[];
};

export type { RecurringTotalChangeConfirmation } from './contractWizardActionErrors';

const normalizeDateOnly = (input?: unknown): string | undefined => {
  if (input == null) return undefined;

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return undefined;
    return input.toISOString().split('T')[0];
  }

  if (typeof input !== 'string') return undefined;

  if (!input) return undefined;
  const trimmed = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (trimmed.includes('T')) return trimmed.split('T')[0];
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [, mmRaw, ddRaw, yyyy] = match;
    const mm = mmRaw.padStart(2, '0');
    const dd = ddRaw.padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return trimmed;
};

const isBucketConfig = (
  config: IContractLineServiceBucketConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | null
): config is IContractLineServiceBucketConfig =>
  Boolean(config && 'total_minutes' in config && 'overage_rate' in config && 'allow_rollover' in config);

const isHourlyConfig = (
  config: IContractLineServiceFixedConfig | IContractLineServiceBucketConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | null
): config is IContractLineServiceHourlyConfig =>
  Boolean(config && 'hourly_rate' in config && 'minimum_billable_time' in config);

const isUsageConfig = (
  config: IContractLineServiceFixedConfig | IContractLineServiceBucketConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | null
): config is IContractLineServiceUsageConfig =>
  Boolean(config && 'unit_of_measure' in config && 'enable_tiered_pricing' in config);

const toPositiveCentsOrUndefined = (value: unknown): number | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  const numeric = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  const rounded = Math.round(numeric);
  return rounded > 0 ? rounded : undefined;
};

const firstPositiveRateInCents = (...candidates: unknown[]): number | undefined => {
  for (const candidate of candidates) {
    const normalized = toPositiveCentsOrUndefined(candidate);
    if (normalized !== undefined) {
      return normalized;
    }
  }
  return undefined;
};

type ContractLineMode = 'Fixed' | 'Hourly' | 'Usage';
type BillingMode = 'fixed' | 'hourly' | 'usage';

const resolveBillingMode = (mode: ContractLineMode): BillingMode =>
  mode === 'Hourly' ? 'hourly' : mode === 'Usage' ? 'usage' : 'fixed';

const fetchModeDefaultRatesByServiceId = async (
  trx: Knex | Knex.Transaction,
  tenant: string,
  serviceIds: string[],
  mode: ContractLineMode,
  currencyCode: string
): Promise<Map<string, number>> => {
  const uniqueServiceIds = Array.from(new Set(serviceIds.filter(Boolean)));
  if (uniqueServiceIds.length === 0) {
    return new Map();
  }

  const rows = await tenantDb(trx, tenant).table('service_catalog_mode_defaults')
    .where({ billing_mode: resolveBillingMode(mode), currency_code: currencyCode })
    .whereIn('service_id', uniqueServiceIds)
    .select('service_id', 'rate');

  const defaultsByServiceId = new Map<string, number>();
  rows.forEach((row: { service_id: string; rate: number }) => {
    const normalizedRate = toPositiveCentsOrUndefined(row.rate);
    if (normalizedRate !== undefined) {
      defaultsByServiceId.set(row.service_id, normalizedRate);
    }
  });

  return defaultsByServiceId;
};

// ---------------------------------------------------------------------------
// Template wizard
// ---------------------------------------------------------------------------

export const createContractTemplateFromWizard = withAuth(async (
  user,
  { tenant },
  submission: ContractTemplateWizardSubmission,
  options?: { isDraft?: boolean }
): Promise<ContractWizardResult | ContractWizardActionError> => {
  const isDraft = options?.isDraft ?? false;
  const isBypass = process.env.E2E_AUTH_BYPASS === 'true';

  if (!isBypass) {
    const canCreateBilling = await hasPermission(user, 'billing', 'create');
    const canUpdateBilling = await hasPermission(user, 'billing', 'update');
    if (!canCreateBilling || !canUpdateBilling) {
      return permissionError('Permission denied: Cannot create billing templates', 'msp/contracts:errors.wizard.permissions.createTemplates');
    }
  }

  if (typeof submission.currency_code !== 'string' || !/^[A-Z]{3}$/.test(submission.currency_code) || !isSupportedCurrency(submission.currency_code)) {
    return actionError(
      `"${String(submission.currency_code)}" is not a valid ISO 4217 currency code`,
      'msp/contracts:errors.wizard.invalidTemplateCurrency',
      { currency: String(submission.currency_code) },
    );
  }

  const { knex } = await createTenantKnex();

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
    const now = new Date();
    const nowIso = now.toISOString();
    const templateId = uuidv4();
    // Every amount this action writes is in the template's base currency.
    const templateCurrencyCode = submission.currency_code;

    // Validate before any write so a rejected per-seat submission leaves no
    // half-built template behind. A template unit rate is optional.
    assertFixedServiceBasisInputs(
      (submission.fixed_services || []).filter((service) => service?.service_id),
      { requireUnitRate: false },
    );

    await tenantDb(trx, tenant).table('contract_templates').insert({
      tenant,
      template_id: templateId,
      template_name: submission.contract_name,
      template_description: submission.description ?? null,
      default_billing_frequency: submission.billing_frequency ?? 'monthly',
      currency_code: templateCurrencyCode,
      template_status: isDraft ? 'draft' : 'published',
      template_metadata: null,
      created_at: nowIso,
      updated_at: nowIso,
    });

    const filteredFixedServices = (submission.fixed_services || []).filter((service) => service?.service_id);
    const filteredProductServices = (submission.product_services || []).filter((service) => service?.service_id);
    const filteredHourlyServices = (submission.hourly_services || []).filter((service) => service?.service_id);
    const filteredUsageServices = (submission.usage_services || []).filter((service) => service?.service_id);
    const prepaidBlockLineInputs = (Array.isArray(submission.prepaid_block_lines) ? submission.prepaid_block_lines : [])
      .map((entry) => ({
        ...entry,
        services: (entry.services ?? []).filter((service) => service?.service_id),
      }))
      .filter((entry) => entry.services.length > 0);
    const prepaidBlockServices = prepaidBlockLineInputs.flatMap((entry) => entry.services);

    const allServiceIds = [
      ...filteredFixedServices.map((s) => s.service_id),
      ...filteredProductServices.map((s) => s.service_id),
      ...filteredHourlyServices.map((s) => s.service_id),
      ...filteredUsageServices.map((s) => s.service_id),
      ...prepaidBlockServices.map((s) => s.service_id),
    ];
    const serviceCatalogById = new Map<string, any>();
    // Snapshot rates come from the catalog IN THE TEMPLATE'S CURRENCY only: the
    // mode default first, then the current service_prices row. The currency-
    // untagged service_catalog.default_rate is never used, so a EUR template
    // can no longer pick up a USD price. A service with no price in the
    // currency gets no snapshot and the member follows the catalog.
    const [fixedCatalog, hourlyCatalog, usageCatalog] = await Promise.all([
      fetchCurrencyCatalogRates(trx, tenant, filteredFixedServices.map((s) => s.service_id), 'fixed', templateCurrencyCode),
      fetchCurrencyCatalogRates(
        trx,
        tenant,
        [...filteredHourlyServices, ...prepaidBlockServices].map((s) => s.service_id),
        'hourly',
        templateCurrencyCode,
      ),
      fetchCurrencyCatalogRates(trx, tenant, filteredUsageServices.map((s) => s.service_id), 'usage', templateCurrencyCode),
    ]);
    // Prepaid block lines read their hourly mode defaults from this map; it is
    // the same `service_catalog_mode_defaults` lookup, now in the template's
    // own currency rather than a hard-coded USD.
    const hourlyModeDefaultsByServiceId = hourlyCatalog.modeDefaults;

    if (allServiceIds.length > 0) {
      const services = await tenantDb(trx, tenant).table('service_catalog')
        .whereIn('service_id', allServiceIds)
        .select('service_id', 'service_name', 'billing_method', 'item_kind', 'is_active', 'default_rate');

      services.forEach((service: any) => {
        serviceCatalogById.set(service.service_id, service);
      });

      for (const item of filteredFixedServices) {
        const match = services.find((s) => s.service_id === item.service_id);
        if (!match) continue;
        if (match.item_kind !== 'service') {
          throw new Error(
            `Catalog item "${match.service_name}" must be a service to be added to fixed fee template lines.`
          );
        }
      }

      for (const item of filteredProductServices) {
        const match = services.find((s) => s.service_id === item.service_id);
        if (!match) continue;
        if (match.item_kind !== 'product') {
          throw new Error(`Catalog item "${match.service_name}" must be a product to be added to product lines.`);
        }
        if (match.is_active === false) {
          throw new Error(`Product "${match.service_name}" is inactive and cannot be attached to new templates.`);
        }
      }

      for (const item of filteredHourlyServices) {
        const match = services.find((s) => s.service_id === item.service_id);
        if (!match) continue;
        if (match.item_kind !== 'service') {
          throw new Error(
            `Catalog item "${match.service_name}" must be a service to be added to hourly template lines.`
          );
        }
      }

      for (const item of prepaidBlockServices) {
        const match = services.find((s) => s.service_id === item.service_id);
        if (!match) continue;
        if (match.item_kind !== 'service') {
          throw new Error(
            `Catalog item "${match.service_name}" must be a service to be added to prepaid block template lines.`
          );
        }
      }

      for (const item of filteredUsageServices) {
        const match = services.find((s) => s.service_id === item.service_id);
        if (!match) continue;
        if (match.item_kind !== 'service') {
          throw new Error(
            `Catalog item "${match.service_name}" must be a service to be added to usage template lines.`
          );
        }
      }
    }

    const createdContractLineIds: string[] = [];
    let primaryContractLineId: string | undefined;
    let nextDisplayOrder = 0;
    const planServiceConfigService = new ContractLineServiceConfigurationService(trx, tenant);
    const recurringAuthoringPolicy = resolveRecurringAuthoringPolicy({
      // Fixed and Product lines: advance is allowed, so the contract-wide value applies.
      lineType: 'Fixed',
      cadenceOwner: submission.cadence_owner,
      defaultCadenceOwner: DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER,
      contractWideBillingTiming: submission.billing_timing,
      enableProration: submission.enable_proration,
    });
    // Hourly and Usage lines bill in arrears whatever the contract-wide value is.
    const arrearsOnlyLinePolicy = resolveRecurringAuthoringPolicy({
      lineType: 'Hourly',
      cadenceOwner: submission.cadence_owner,
      defaultCadenceOwner: DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER,
      contractWideBillingTiming: submission.billing_timing,
      enableProration: submission.enable_proration,
    });

    const recordTemplateMapping = async (lineId: string, customRate?: number | null) => {
      const effectiveLineId = await ensureTemplateLineSnapshot(
        trx,
        tenant,
        templateId,
        lineId,
        customRate ?? undefined
      );

      await tenantDb(trx, tenant).table('contract_template_lines')
        .where({
          tenant,
          template_id: templateId,
          template_line_id: effectiveLineId,
        })
        .update({
          display_order: nextDisplayOrder,
          custom_rate: customRate ?? null,
          updated_at: trx.fn.now(),
        });

      nextDisplayOrder += 1;
      return effectiveLineId;
    };

    if (filteredFixedServices.length > 0) {
      const createdFixedLine = await ContractLine.create(trx, {
        contract_line_name: `${submission.contract_name} - Fixed Fee`,
        billing_frequency: submission.billing_frequency ?? 'monthly',
        billing_timing: recurringAuthoringPolicy.billingTiming,
        cadence_owner: recurringAuthoringPolicy.cadenceOwner,
        is_custom: true,
        service_category: null as any,
        contract_line_type: 'Fixed',
        hourly_rate: null,
        minimum_billable_time: null,
        round_up_to_nearest: null,
        enable_overtime: null,
        overtime_rate: null,
        overtime_threshold: null,
        enable_after_hours_rate: null,
        after_hours_multiplier: null,
        is_template: true,
      } as any);
      const planId = createdFixedLine.contract_line_id!;
      createdContractLineIds.push(planId);
      if (!primaryContractLineId) {
        primaryContractLineId = planId;
      }

      // Create template line mapping FIRST before inserting fixed config
      const templateLineId = await recordTemplateMapping(planId, null);

      // Only bundle members share the line base rate. A per-seat member bills
      // quantity × unit rate on its own, so a stale base rate left over from
      // an earlier bundle draft must not leak into a pure per-seat template.
      const templateHasBundleMember = hasBundleFixedService(filteredFixedServices);
      const fixedBaseRateCents = templateHasBundleMember ? submission.fixed_base_rate ?? 0 : 0;
      // Insert into contract_template_line_fixed_config (not contract_line_fixed_config)
      await tenantDb(trx, tenant).table('contract_template_line_fixed_config').insert({
        tenant,
        template_line_id: templateLineId,
        base_rate: fixedBaseRateCents,  // Already in cents from frontend
        enable_proration: recurringAuthoringPolicy.enableProration,
        billing_cycle_alignment: recurringAuthoringPolicy.billingCycleAlignment,
        created_at: nowIso,
        updated_at: nowIso,
      });

      const bundleShares = allocateBundleBaseRate(filteredFixedServices, fixedBaseRateCents);

      for (const [index, service] of filteredFixedServices.entries()) {
        const isUnit = isUnitFixedService(service);
        const quantity = service.quantity ?? (isUnit ? 0 : 1);

        let serviceBaseRate = 0;
        if (!isUnit) {
          if (fixedBaseRateCents) {
            serviceBaseRate = bundleShares[index] ?? 0;
          } else {
            serviceBaseRate =
              firstPositiveRateInCents(
                fixedCatalog.modeDefaults.get(service.service_id),
                fixedCatalog.currentPrices.get(service.service_id)
              ) ?? 0;
          }
        }

        // Insert into template line services table (not contract_line_services)
        await tenantDb(trx, tenant).table('contract_template_line_services').insert({
          tenant,
          template_line_id: templateLineId,
          service_id: service.service_id,
          quantity,
          custom_rate: serviceBaseRate > 0 ? serviceBaseRate : null,  // Already in cents
          created_at: nowIso,
          updated_at: nowIso,
        });

        // Insert into template line service configuration
        // For bundle Fixed services, the allocated rate is stored in custom_rate.
        // A per-seat service carries no allocation: its basis and optional
        // default unit rate live in the template fixed-config row below.
        const configId = uuidv4();
        await tenantDb(trx, tenant).table('contract_template_line_service_configuration').insert({
          tenant,
          config_id: configId,
          template_line_id: templateLineId,
          service_id: service.service_id,
          configuration_type: 'Fixed',
          quantity,
          custom_rate: serviceBaseRate > 0 ? serviceBaseRate : null,  // Already in cents
          created_at: nowIso,
          updated_at: nowIso,
        });

        if (isUnit) {
          await tenantDb(trx, tenant).table('contract_template_line_service_fixed_config').insert({
            tenant,
            config_id: configId,
            base_rate: service.unit_rate ?? null,  // Minor units; null follows the catalog in the contract currency
            pricing_basis: 'unit',
            created_at: nowIso,
            updated_at: nowIso,
          });
        }
      }
    }

    if (filteredProductServices.length > 0) {
      const createdProductsLine = await ContractLine.create(trx, {
        contract_line_name: `${submission.contract_name} - Products`,
        billing_frequency: submission.billing_frequency ?? 'monthly',
        billing_timing: recurringAuthoringPolicy.billingTiming,
        cadence_owner: recurringAuthoringPolicy.cadenceOwner,
        is_custom: true,
        service_category: null as any,
        contract_line_type: 'Fixed',
        is_template: true,
        minimum_billable_time: null,
        round_up_to_nearest: null,
      } as any);
      const productsLineId = createdProductsLine.contract_line_id!;
      createdContractLineIds.push(productsLineId);
      if (!primaryContractLineId) {
        primaryContractLineId = productsLineId;
      }

      const templateLineId = await recordTemplateMapping(productsLineId, null);
      await tenantDb(trx, tenant).table('contract_template_line_fixed_config').insert({
        tenant,
        template_line_id: templateLineId,
        base_rate: 0,
        enable_proration: recurringAuthoringPolicy.enableProration,
        billing_cycle_alignment: recurringAuthoringPolicy.billingCycleAlignment,
        created_at: nowIso,
        updated_at: nowIso,
      });

      for (const product of filteredProductServices) {
        const quantity = product.quantity ?? 1;
        await tenantDb(trx, tenant).table('contract_template_line_services').insert({
          tenant,
          template_line_id: templateLineId,
          service_id: product.service_id,
          quantity,
          custom_rate: null,
          created_at: nowIso,
          updated_at: nowIso,
        });

        const configId = uuidv4();
        await tenantDb(trx, tenant).table('contract_template_line_service_configuration').insert({
          tenant,
          config_id: configId,
          template_line_id: templateLineId,
          service_id: product.service_id,
          configuration_type: 'Fixed',
          quantity,
          custom_rate: null,
          created_at: nowIso,
          updated_at: nowIso,
        });
      }
    }

    if (filteredHourlyServices.length > 0) {
      const createdHourlyLine = await ContractLine.create(trx, {
        contract_line_name: `${submission.contract_name} - Hourly`,
        billing_frequency: submission.billing_frequency ?? 'monthly',
        billing_timing: arrearsOnlyLinePolicy.billingTiming,
        cadence_owner: arrearsOnlyLinePolicy.cadenceOwner,
        is_custom: true,
        service_category: null as any,
        contract_line_type: 'Hourly',
        is_template: true,
        minimum_billable_time: submission.minimum_billable_time ?? 15,
        round_up_to_nearest: submission.round_up_to_nearest ?? 15,
      } as any);
      const hourlyPlanId = createdHourlyLine.contract_line_id!;
      createdContractLineIds.push(hourlyPlanId);
      if (!primaryContractLineId) {
        primaryContractLineId = hourlyPlanId;
      }

      // Create template line mapping FIRST before inserting services
      const templateLineId = await recordTemplateMapping(hourlyPlanId, null);

      for (const service of filteredHourlyServices) {
        const normalizedHourlyRate = firstPositiveRateInCents(
          service.hourly_rate,
          hourlyCatalog.modeDefaults.get(service.service_id),
          hourlyCatalog.currentPrices.get(service.service_id)
        );

        // Insert into template line services table (not contract_line_services)
        await tenantDb(trx, tenant).table('contract_template_line_services').insert({
          tenant,
          template_line_id: templateLineId,
          service_id: service.service_id,
          quantity: null,
          custom_rate: normalizedHourlyRate ?? null,
          created_at: nowIso,
          updated_at: nowIso,
        });

        // Insert into template line service configuration
        const configId = uuidv4();
        await tenantDb(trx, tenant).table('contract_template_line_service_configuration').insert({
          tenant,
          config_id: configId,
          template_line_id: templateLineId,
          service_id: service.service_id,
          configuration_type: 'Hourly',
          quantity: null,
          custom_rate: normalizedHourlyRate ?? null,
          created_at: nowIso,
          updated_at: nowIso,
        });

        // Insert hourly config for template
        await tenantDb(trx, tenant).table('contract_template_line_service_hourly_config').insert({
          tenant,
          config_id: configId,
          hourly_rate: normalizedHourlyRate ?? null,
          minimum_billable_time: submission.minimum_billable_time ?? 15,
          round_up_to_nearest: submission.round_up_to_nearest ?? 15,
          enable_overtime: false,
          overtime_rate: null,
          overtime_threshold: null,
          enable_after_hours_rate: false,
          after_hours_multiplier: null,
          created_at: nowIso,
          updated_at: nowIso,
        });

        if (service.bucket_overlay) {
          // Insert bucket config for template
          await tenantDb(trx, tenant).table('contract_template_line_service_bucket_config').insert({
            tenant,
            config_id: configId,
            total_minutes: service.bucket_overlay.total_minutes ?? 0,
            billing_period: service.bucket_overlay.billing_period ?? 'monthly',
            overage_rate: service.bucket_overlay.overage_rate ?? 0,
            allow_rollover: service.bucket_overlay.allow_rollover ?? false,
            created_at: nowIso,
            updated_at: nowIso,
          });
        }
      }
    }

    // Prepaid Block lines: each entry is its own Hourly template line plus one
    // contract_template_line_prepaid_blocks row. Template rates are optional (the client
    // contract resolves rates in its own currency); block_price is a currency-neutral amount.
    for (const [blockIndex, entry] of prepaidBlockLineInputs.entries()) {
      const blockLine = await ContractLine.create(trx, {
        contract_line_name:
          entry.name?.trim() ||
          (prepaidBlockLineInputs.length > 1
            ? `${submission.contract_name} - Prepaid Block ${blockIndex + 1}`
            : `${submission.contract_name} - Prepaid Block`),
        billing_frequency: submission.billing_frequency ?? 'monthly',
        // Line stays arrears; the block fee goes in advance via its prepaid_block charge stream.
        billing_timing: arrearsOnlyLinePolicy.billingTiming,
        cadence_owner: arrearsOnlyLinePolicy.cadenceOwner,
        is_custom: true,
        service_category: null as any,
        contract_line_type: 'Hourly',
        is_template: true,
        minimum_billable_time: submission.minimum_billable_time ?? 15,
        round_up_to_nearest: submission.round_up_to_nearest ?? 15,
      } as any);
      const blockPlanId = blockLine.contract_line_id!;
      createdContractLineIds.push(blockPlanId);
      if (!primaryContractLineId) {
        primaryContractLineId = blockPlanId;
      }

      const blockTemplateLineId = await recordTemplateMapping(blockPlanId, null);

      for (const service of entry.services) {
        const normalizedHourlyRate = firstPositiveRateInCents(
          service.hourly_rate,
          hourlyModeDefaultsByServiceId.get(service.service_id),
          serviceCatalogById.get(service.service_id)?.default_rate
        );
        await tenantDb(trx, tenant).table('contract_template_line_services').insert({
          tenant,
          template_line_id: blockTemplateLineId,
          service_id: service.service_id,
          quantity: null,
          custom_rate: normalizedHourlyRate ?? null,
          created_at: nowIso,
          updated_at: nowIso,
        });

        const configId = uuidv4();
        await tenantDb(trx, tenant).table('contract_template_line_service_configuration').insert({
          tenant,
          config_id: configId,
          template_line_id: blockTemplateLineId,
          service_id: service.service_id,
          configuration_type: 'Hourly',
          quantity: null,
          custom_rate: normalizedHourlyRate ?? null,
          created_at: nowIso,
          updated_at: nowIso,
        });
        await tenantDb(trx, tenant).table('contract_template_line_service_hourly_config').insert({
          tenant,
          config_id: configId,
          hourly_rate: normalizedHourlyRate ?? null,
          minimum_billable_time: submission.minimum_billable_time ?? 15,
          round_up_to_nearest: submission.round_up_to_nearest ?? 15,
          enable_overtime: false,
          overtime_rate: null,
          overtime_threshold: null,
          enable_after_hours_rate: false,
          after_hours_multiplier: null,
          created_at: nowIso,
          updated_at: nowIso,
        });
      }

      await upsertTemplateLinePrepaidBlockInTransaction(trx, tenant, blockTemplateLineId, entry.block);
    }

    if (filteredUsageServices.length > 0) {
      const createdUsageLine = await ContractLine.create(trx, {
        contract_line_name: `${submission.contract_name} - Usage`,
        billing_frequency: submission.billing_frequency ?? 'monthly',
        billing_timing: arrearsOnlyLinePolicy.billingTiming,
        cadence_owner: arrearsOnlyLinePolicy.cadenceOwner,
        is_custom: true,
        service_category: null as any,
        contract_line_type: 'Usage',
        is_template: true,
      } as any);
      const usagePlanId = createdUsageLine.contract_line_id!;
      createdContractLineIds.push(usagePlanId);
      if (!primaryContractLineId) {
        primaryContractLineId = usagePlanId;
      }

      // Create template line mapping FIRST before inserting services
      const templateLineId = await recordTemplateMapping(usagePlanId, null);

      for (const service of filteredUsageServices) {
        const normalizedUnitRate = firstPositiveRateInCents(
          service.unit_rate,
          usageCatalog.modeDefaults.get(service.service_id),
          usageCatalog.currentPrices.get(service.service_id)
        );

        // Insert into template line services table (not contract_line_services)
        await tenantDb(trx, tenant).table('contract_template_line_services').insert({
          tenant,
          template_line_id: templateLineId,
          service_id: service.service_id,
          quantity: null,
          custom_rate: normalizedUnitRate ?? null,
          created_at: nowIso,
          updated_at: nowIso,
        });

        // Insert into template line service configuration
        const configId = uuidv4();
        await tenantDb(trx, tenant).table('contract_template_line_service_configuration').insert({
          tenant,
          config_id: configId,
          template_line_id: templateLineId,
          service_id: service.service_id,
          configuration_type: 'Usage',
          quantity: null,
          custom_rate: normalizedUnitRate ?? null,
          created_at: nowIso,
          updated_at: nowIso,
        });

        // Insert usage config for template
        await tenantDb(trx, tenant).table('contract_template_line_service_usage_config').insert({
          tenant,
          config_id: configId,
          ...withUnitCode({ unit_of_measure: service.unit_of_measure || resolveUnitOfMeasure({ fallback: 'C62' }).label }),
          enable_tiered_pricing: false,
          minimum_usage: 0,
          base_rate: normalizedUnitRate ?? null,
          created_at: nowIso,
          updated_at: nowIso,
        });

        if (service.bucket_overlay) {
          // Insert bucket config for template
          await tenantDb(trx, tenant).table('contract_template_line_service_bucket_config').insert({
            tenant,
            config_id: configId,
            total_minutes: service.bucket_overlay.total_minutes ?? 0,
            billing_period: service.bucket_overlay.billing_period ?? 'monthly',
            overage_rate: service.bucket_overlay.overage_rate ?? 0,
            allow_rollover: service.bucket_overlay.allow_rollover ?? false,
            created_at: nowIso,
            updated_at: nowIso,
          });
        }
      }
    }

    return {
      contract_id: templateId,
      contract_line_id: primaryContractLineId,
      contract_line_ids: createdContractLineIds,
    };
    });
  } catch (error) {
    const expected = contractWizardActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

// ---------------------------------------------------------------------------
// Client wizard
// ---------------------------------------------------------------------------

/**
 * Currency a new contract for `clientId` is billed in: the client's configured
 * default, then the tenant default (default_billing_settings), then 'USD' as the
 * last-resort default the contract record has always used. Shared by contract
 * creation and the template preview so both resolve the same currency.
 */
const resolveClientContractCurrency = async (
  knex: Knex | Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<string> => {
  const clientRow = await tenantDb(knex, tenant).table('clients')
    .where({ client_id: clientId })
    .select('default_currency_code')
    .first();
  if (clientRow?.default_currency_code) {
    return clientRow.default_currency_code;
  }
  const billingSettings = await tenantDb(knex, tenant).table('default_billing_settings')
    .select('default_currency_code')
    .first();
  return billingSettings?.default_currency_code || 'USD';
};

/**
 * Writes the wizard's contract-wide discounts as definitions owned by the new
 * client contract. Validation is the authoring module's, so a wizard draft and
 * the contract's Discounts tab accept exactly the same discounts.
 */
const createWizardContractDiscounts = async (
  trx: Knex.Transaction,
  tenant: string,
  params: {
    clientContractId: string;
    discounts: ClientContractWizardDiscountInput[];
  },
): Promise<void> => {
  for (const discount of params.discounts) {
    const input = {
      discount_name: typeof discount?.discount_name === 'string' ? discount.discount_name.trim() : '',
      discount_type: discount?.discount_type === 'fixed' ? ('fixed' as const) : ('percentage' as const),
      value: Number(discount?.value),
      start_date: normalizeDateOnly(discount?.start_date) ?? '',
      end_date: discount?.end_date ? (normalizeDateOnly(discount.end_date) ?? null) : null,
      scope: 'contract' as const,
      is_active: true,
    };
    const invalid = validateDiscountInput(input);
    if (invalid) {
      throw new Error(`${CONTRACT_DISCOUNT_PREFIX}${invalid}`);
    }

    const discountId = uuidv4();
    await tenantDb(trx, tenant).table('discounts').insert({
      tenant,
      discount_id: discountId,
      discount_name: input.discount_name,
      discount_type: input.discount_type,
      value: toStoredDiscountValue(input),
      start_date: `${input.start_date}T00:00:00.000Z`,
      end_date: input.end_date ? `${input.end_date}T00:00:00.000Z` : null,
      is_active: true,
      scope: 'contract',
      scope_service_id: null,
      applies_to_item_id: null,
      priority: null,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });
    await tenantDb(trx, tenant).table('contract_discount_assignments').insert({
      tenant,
      assignment_id: uuidv4(),
      client_contract_id: params.clientContractId,
      discount_id: discountId,
      created_at: trx.fn.now(),
    });
  }
};

export const createClientContractFromWizard = withAuth(async (
  user,
  { tenant },
  submission: ClientContractWizardSubmission,
  options?: { isDraft?: boolean }
): Promise<ContractWizardResult | RecurringTotalChangeConfirmation | ContractWizardActionError> => {
  const isDraft = options?.isDraft ?? false;
  const isBypass = process.env.E2E_AUTH_BYPASS === 'true';

  if (!isBypass) {
    const canCreateBilling = await hasPermission(user, 'billing', 'create');
    const canUpdateBilling = await hasPermission(user, 'billing', 'update');
    if (!canCreateBilling || !canUpdateBilling) {
      return permissionError('Permission denied: Cannot create billing contracts', 'msp/contracts:errors.wizard.permissions.createContracts');
    }
  }

  const { knex } = await createTenantKnex();

  try {
  let createdForWorkflow: {
    contractId: string;
    clientContractId: string;
    clientId: string;
    createdAt: string;
    startDate: string;
    endDate: string | null;
    status: string;
    actorUserId?: string;
  } | null = null;
  let renewalForWorkflow: { renewalAt: string; daysUntilRenewal: number } | null = null;

  const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const startDate = normalizeDateOnly(submission.start_date);
    if (!startDate) {
      throw new Error('Contract start date is required');
    }
    const endDate = normalizeDateOnly(submission.end_date) ?? null;

    // Template mode: the template is the source of truth and is cloned line by
    // line below, so the wizard's flat per-type state must not also create lines.
    const templateId =
      typeof submission.template_id === 'string' && submission.template_id.trim().length > 0
        ? submission.template_id.trim()
        : null;

    const fixedLinesInput = templateId ? [] : normalizeFixedLinesInput(submission);
    // An unfilled placeholder (no services, no recurring amount) carries no revenue and is not written.
    const writableFixedLines = fixedLinesInput.filter(
      (line) => line.services.length > 0 || Number(line.base_rate ?? 0) > 0,
    );

    // Reject unstorable per-seat rows before anything is written.
    for (const line of writableFixedLines) {
      assertFixedServiceBasisInputs(line.services);
    }

    // A recurring amount with nothing to bill it on is unbillable (the engine raises
    // FIXED_LINE_NO_SERVICES). Save Draft keeps it as-is; Finish Setup refuses it.
    if (!isDraft) {
      writableFixedLines.forEach((line, index) => {
        if (line.services.length === 0) {
          throw new Error(
            fixedLineNoServiceMessage(resolveFixedLineName(submission.contract_name, line, index, writableFixedLines.length)),
          );
        }
      });
    }

    const now = new Date();
    const nowIso = now.toISOString();

    const existingContractId =
      typeof submission.contract_id === 'string' && submission.contract_id.trim().length > 0
        ? submission.contract_id.trim()
        : null;
    const contractId = existingContractId ?? uuidv4();

    // Resolve the contract currency. A contract is billed in its client's currency, so for a
    // NEW contract derive it from the client's configured default currency
    // (clients.default_currency_code), with the tenant default (default_billing_settings) and
    // then 'USD' as fallbacks — the client takes precedence over the tenant default. For an
    // existing draft we keep whatever currency it was created with. This value is used for the
    // contract record AND for matching service-period prices below, so it must be consistent.
    let resolvedCurrencyCode: string = submission.currency_code;
    if (!existingContractId) {
      resolvedCurrencyCode = await resolveClientContractCurrency(trx, tenant, submission.client_id);
    }

    let baselineMonthlyCents: number | null = null;

    // LEVERAGE: friction wizard-delete-and-rebuild — the wizard deletes every line and rebuilds from its
    // own smaller model, so anything it cannot hold is lost (the monthly-value guard below is the safety net).
    // Reconciling lines in place would remove the need for the guard and the resume fidelity check.
    const clearExistingContractData = async (targetContractId: string) => {
      await tenantDb(trx, tenant).table('client_contracts')
        .where({ contract_id: targetContractId })
        .delete();

      const contractLineIds = await tenantDb(trx, tenant).table('contract_lines')
        .where({ contract_id: targetContractId })
        .pluck('contract_line_id');

      if (contractLineIds.length === 0) {
        return;
      }

      await tenantDb(trx, tenant).table('time_entries')
        .whereIn('contract_line_id', contractLineIds)
        .update({ contract_line_id: null });

      const configIds = await tenantDb(trx, tenant).table('contract_line_service_configuration')
        .whereIn('contract_line_id', contractLineIds)
        .pluck('config_id');

      if (configIds.length > 0) {
        await tenantDb(trx, tenant).table('contract_line_service_bucket_config')
          .whereIn('config_id', configIds)
          .delete();

        // Typed config rows keyed by config_id have no FK to the configuration
        // row; clear them explicitly so re-saving a draft leaves no orphans.
        await tenantDb(trx, tenant).table('contract_line_service_fixed_config')
          .whereIn('config_id', configIds)
          .delete();
        await tenantDb(trx, tenant).table('contract_line_service_hourly_configs')
          .whereIn('config_id', configIds)
          .delete();
        await tenantDb(trx, tenant).table('contract_line_service_rate_tiers')
          .whereIn('config_id', configIds)
          .delete();

        await tenantDb(trx, tenant).table('contract_line_service_hourly_config')
          .whereIn('config_id', configIds)
          .delete();

        await tenantDb(trx, tenant).table('contract_line_service_usage_config')
          .whereIn('config_id', configIds)
          .delete();

        // Rate tiers hang off the usage config's config_id, and fixed/hourly_configs are the
        // shapes a quote-converted draft is written with. All three carry NO ACTION FKs back to
        // contract_line_service_configuration, so skipping them makes the parent delete below
        // raise 23503 when the wizard finalizes such a draft.
        await tenantDb(trx, tenant).table('contract_line_service_rate_tiers')
          .whereIn('config_id', configIds)
          .delete();

        await tenantDb(trx, tenant).table('contract_line_service_fixed_config')
          .whereIn('config_id', configIds)
          .delete();

        await tenantDb(trx, tenant).table('contract_line_service_hourly_configs')
          .whereIn('config_id', configIds)
          .delete();

        await tenantDb(trx, tenant).table('contract_line_service_configuration')
          .whereIn('config_id', configIds)
          .delete();
      }

      await tenantDb(trx, tenant).table('contract_line_service_defaults')
        .whereIn('contract_line_id', contractLineIds)
        .delete();

      await tenantDb(trx, tenant).table('contract_line_services')
        .whereIn('contract_line_id', contractLineIds)
        .delete();

      await tenantDb(trx, tenant).table('contract_lines')
        .where({ contract_id: targetContractId })
        .delete();
    };

    if (existingContractId) {
      const existing = await tenantDb(trx, tenant).table('contracts')
        .where({ contract_id: existingContractId })
        .andWhere((builder) => builder.whereNull('is_template').orWhere('is_template', false))
        .first('contract_id', 'status');

      if (!existing) {
        throw new Error('Draft contract not found');
      }

      if (existing.status !== 'draft') {
        throw new Error('Only draft contracts can be updated via the wizard');
      }

      // The wizard rebuilds assignments and lines. Once standing terms exist,
      // that would discard their independent definitions and source identities.
      const owners = await tenantDb(trx, tenant).table('client_contracts')
        .where({ contract_id: existingContractId }).pluck('client_contract_id');
      const terms = await tenantDb(trx, tenant).table('contract_discount_assignments')
        .whereIn('client_contract_id', owners).first('assignment_id');
      const lineTerms = await tenantDb(trx, tenant).table('contract_line_discounts')
        .whereIn('client_contract_id', owners).first('discount_id');
      const copiedTerms = await tenantDb(trx, tenant).table('contract_template_discount_copies')
        .whereIn('client_contract_id', owners).first('discount_id');
      if (terms || lineTerms || copiedTerms) {
        return actionError(
          'This draft has standing discount terms. Edit its Lines and Discounts tabs to preserve those terms.',
          'msp/contracts:errors.wizard.standingTerms',
        );
      }

      // Server-side monthly fixed value as saved, read before the rebuild so the guard below can
      // tell whether the rebuild changed what this draft bills.
      baselineMonthlyCents =
        (await getContractMonthlyFixedValuesByContract(trx, tenant, [existingContractId])).get(existingContractId)
          ?.monthlyValueCents ?? 0;

      await clearExistingContractData(existingContractId);

      await tenantDb(trx, tenant).table('contracts')
        .where({ contract_id: existingContractId })
        .update({
          contract_name: submission.contract_name,
          contract_description: submission.description ?? null,
          owner_client_id: submission.client_id,
          billing_frequency: submission.billing_frequency ?? 'monthly',
          currency_code: resolvedCurrencyCode,
          is_active: !isDraft,
          status: isDraft ? 'draft' : 'active',
          updated_at: nowIso,
        });
    } else {
      await tenantDb(trx, tenant).table('contracts').insert({
        tenant,
        contract_id: contractId,
        contract_name: submission.contract_name,
        contract_description: submission.description ?? null,
        owner_client_id: submission.client_id,
        billing_frequency: submission.billing_frequency ?? 'monthly',
        currency_code: resolvedCurrencyCode,
        is_active: !isDraft,
        status: isDraft ? 'draft' : 'active',
        is_template: false,
        created_at: nowIso,
        updated_at: nowIso,
      });
    }

    const productServiceInputs = !templateId && Array.isArray(submission.product_services) ? submission.product_services : [];
    const hourlyServiceInputs = !templateId && Array.isArray(submission.hourly_services) ? submission.hourly_services : [];
    const usageServiceInputs = !templateId && Array.isArray(submission.usage_services) ? submission.usage_services : [];

    const filteredFixedServices = writableFixedLines.flatMap((line) => line.services);
    const filteredProductServices = productServiceInputs.filter((service) => service?.service_id);
    const filteredHourlyServices = hourlyServiceInputs.filter((service) => service?.service_id);
    const filteredUsageServices = usageServiceInputs.filter((service) => service?.service_id);
    const prepaidBlockLineInputs = (
      !templateId && Array.isArray(submission.prepaid_block_lines) ? submission.prepaid_block_lines : []
    )
      .map((entry) => ({
        ...entry,
        services: (entry.services ?? []).filter((service) => service?.service_id),
      }))
      .filter((entry) => entry.services.length > 0);
    const prepaidBlockServices = prepaidBlockLineInputs.flatMap((entry) => entry.services);

    const allServiceIds = [
      ...filteredFixedServices.map((s) => s.service_id),
      ...filteredProductServices.map((s) => s.service_id),
      ...filteredHourlyServices.map((s) => s.service_id),
      ...filteredUsageServices.map((s) => s.service_id),
      ...prepaidBlockServices.map((s) => s.service_id),
    ];
    const serviceCatalogById = new Map<string, any>();
    const contractCurrency = resolvedCurrencyCode || 'USD';
    let fixedModeDefaultsByServiceId = new Map<string, number>();
    let hourlyModeDefaultsByServiceId = new Map<string, number>();
    let usageModeDefaultsByServiceId = new Map<string, number>();

    if (allServiceIds.length > 0) {
      const services = await tenantDb(trx, tenant).table('service_catalog')
        .whereIn('service_id', allServiceIds)
        .select('service_id', 'service_name', 'billing_method', 'item_kind', 'is_active', 'default_rate');

      services.forEach((service: any) => {
        serviceCatalogById.set(service.service_id, service);
      });

      // Validate services have prices in the contract's currency OR have custom rates specified
      fixedModeDefaultsByServiceId = await fetchModeDefaultRatesByServiceId(
        trx,
        tenant,
        filteredFixedServices.map((s) => s.service_id),
        'Fixed',
        contractCurrency
      );
      hourlyModeDefaultsByServiceId = await fetchModeDefaultRatesByServiceId(
        trx,
        tenant,
        [...filteredHourlyServices, ...prepaidBlockServices].map((s) => s.service_id),
        'Hourly',
        contractCurrency
      );
      usageModeDefaultsByServiceId = await fetchModeDefaultRatesByServiceId(
        trx,
        tenant,
        filteredUsageServices.map((s) => s.service_id),
        'Usage',
        contractCurrency
      );

      // Build a map of services with custom rates (user-entered rates override the need for currency prices)
      const servicesWithCustomRates = new Set<string>();

      // Hourly services with hourly_rate specified
      filteredHourlyServices.forEach(s => {
        if (toPositiveCentsOrUndefined(s.hourly_rate) !== undefined) {
          servicesWithCustomRates.add(s.service_id);
        }
      });

      // Prepaid block services with an entered hourly rate (the overage rate) need no currency price either
      prepaidBlockServices.forEach((s) => {
        if (toPositiveCentsOrUndefined(s.hourly_rate) !== undefined) {
          servicesWithCustomRates.add(s.service_id);
        }
      });

      // Usage services with unit_rate specified
      filteredUsageServices.forEach(s => {
        if (toPositiveCentsOrUndefined(s.unit_rate) !== undefined) {
          servicesWithCustomRates.add(s.service_id);
        }
      });

      // Product services with custom_rate specified
      filteredProductServices.forEach((s: any) => {
        if (s.custom_rate !== undefined && s.custom_rate !== null) {
          servicesWithCustomRates.add(s.service_id);
        }
      });

      // Fixed services: a line with a bundle base rate covers all of ITS OWN services with the flat fee,
      // so they need no individual currency pricing. Otherwise check each service's own custom_rate.
      // Unit-priced services carry their own explicit unit rate (validated above), so they never depend
      // on the base rate or a currency price.
      // A service that is uncovered in one line stays uncovered even if another line's base rate covers it.
      const fixedUncoveredInSomeLine = new Set<string>();
      for (const line of writableFixedLines) {
        const lineCoveredByBaseRate = Number(line.base_rate ?? 0) > 0;
        for (const s of line.services) {
          if (isUnitFixedService(s) || lineCoveredByBaseRate) {
            servicesWithCustomRates.add(s.service_id);
          } else if ((s as any).custom_rate !== undefined && (s as any).custom_rate > 0) {
            servicesWithCustomRates.add(s.service_id);
          } else {
            fixedUncoveredInSomeLine.add(s.service_id);
          }
        }
      }

      // Mode-specific defaults (already filtered to the contract currency) satisfy pricing.
      // The legacy service_catalog.default_rate column is untagged (effectively USD-only via the
      // 20251205130000 migration) and is intentionally NOT treated as covering a non-USD contract.
      filteredFixedServices.forEach((service) => {
        if (firstPositiveRateInCents(fixedModeDefaultsByServiceId.get(service.service_id)) !== undefined) {
          servicesWithCustomRates.add(service.service_id);
        }
      });
      filteredHourlyServices.forEach((service) => {
        if (firstPositiveRateInCents(hourlyModeDefaultsByServiceId.get(service.service_id)) !== undefined) {
          servicesWithCustomRates.add(service.service_id);
        }
      });
      prepaidBlockServices.forEach((service) => {
        if (firstPositiveRateInCents(hourlyModeDefaultsByServiceId.get(service.service_id)) !== undefined) {
          servicesWithCustomRates.add(service.service_id);
        }
      });
      filteredUsageServices.forEach((service) => {
        if (firstPositiveRateInCents(usageModeDefaultsByServiceId.get(service.service_id)) !== undefined) {
          servicesWithCustomRates.add(service.service_id);
        }
      });

      // Only check currency prices for services WITHOUT custom rates
      const serviceIdsNeedingCurrencyCheck = allServiceIds.filter(
        (id) =>
          !servicesWithCustomRates.has(id) ||
          (fixedUncoveredInSomeLine.has(id) &&
            firstPositiveRateInCents(fixedModeDefaultsByServiceId.get(id)) === undefined),
      );

      if (serviceIdsNeedingCurrencyCheck.length > 0) {
        // Get services that have prices in the required currency
        const servicesWithPricesQuery = tenantDb(trx, tenant).table('service_catalog as sc')
          .whereIn('sc.service_id', serviceIdsNeedingCurrencyCheck)
          .select(
            'sc.service_id',
            'sc.service_name',
            'sp.price_id'
          );
        tenantDb(trx, tenant).tenantJoin(
          servicesWithPricesQuery,
          'service_prices as sp',
          'sc.service_id',
          'sp.service_id',
          {
            type: 'left',
            on(join) {
              join.andOn('sp.currency_code', '=', trx.raw('?', [contractCurrency]));
            },
          },
        );
        const servicesWithPrices = (await servicesWithPricesQuery) as unknown as Array<{
          service_id: string;
          service_name: string;
          price_id: string | null;
        }>;

        // Find services that don't have a price in the required currency AND don't have custom rates
        const missingPriceServices = servicesWithPrices.filter(s => !s.price_id);
        if (missingPriceServices.length > 0) {
          throw currencyPricingMissingError(
            contractCurrency,
            missingPriceServices.map((s) => `"${s.service_name}"`),
          );
        }
      }

      for (const item of filteredFixedServices) {
        const match = serviceCatalogById.get(item.service_id);
        if (!match) continue;
        if (match.item_kind !== 'service') {
          throw new Error(
            `Catalog item "${match.service_name}" must be a service to be added to fixed fee contract lines.`
          );
        }
      }

      for (const item of filteredProductServices) {
        const match = serviceCatalogById.get(item.service_id);
        if (!match) continue;
        if (match.item_kind !== 'product') {
          throw new Error(`Catalog item "${match.service_name}" must be a product to be added to product lines.`);
        }
        if (match.is_active === false) {
          throw new Error(`Product "${match.service_name}" is inactive and cannot be attached to new contracts.`);
        }
      }

      for (const item of filteredHourlyServices) {
        const match = serviceCatalogById.get(item.service_id);
        if (!match) continue;
        if (match.item_kind !== 'service') {
          throw new Error(
            `Catalog item "${match.service_name}" must be a service to be added to hourly contract lines.`
          );
        }
      }

      for (const item of prepaidBlockServices) {
        const match = serviceCatalogById.get(item.service_id);
        if (!match) continue;
        if (match.item_kind !== 'service') {
          throw new Error(
            `Catalog item "${match.service_name}" must be a service to be added to prepaid block lines.`
          );
        }
      }

      for (const item of filteredUsageServices) {
        const match = serviceCatalogById.get(item.service_id);
        if (!match) continue;
        if (match.item_kind !== 'service') {
          throw new Error(
            `Catalog item "${match.service_name}" must be a service to be added to usage contract lines.`
          );
        }
      }
    }

    const createdContractLineIds: string[] = [];
    // Template line -> the one client line it became. A template Fixed line that
    // holds products becomes two client lines (fixed + products); such a line has
    // no single target, so it is left unmapped and only a line-scoped template
    // discount on it is refused (by cloneTemplateDefaultDiscounts).
    const sourceTemplateLineMap: Record<string, string> = {};
    const splitTemplateLines = new Set<string>();
    const mapSourceTemplateLine = (sourceLineId: string | undefined, targetLineId: string) => {
      if (!sourceLineId || splitTemplateLines.has(sourceLineId)) return;
      const existing = sourceTemplateLineMap[sourceLineId];
      if (existing && existing !== targetLineId) {
        splitTemplateLines.add(sourceLineId);
        delete sourceTemplateLineMap[sourceLineId];
        return;
      }
      sourceTemplateLineMap[sourceLineId] = targetLineId;
    };
    let primaryContractLineId: string | undefined;
    const poolLines: Record<string, Array<{ lineId: string; serviceIds: Set<string> }>> = { hourly: [], usage: [] };
    // Preserve template line scope, including two lines using the same service.
    // Unattributed additions continue to share the wizard's ordinary type line.
    const groupBySourceLine = <T extends { source_template_line_id?: string }>(services: T[]): T[][] => {
      const groups = new Map<string, T[]>();
      for (const service of services) {
        const key = service.source_template_line_id ?? '';
        const group = groups.get(key) ?? [];
        group.push(service);
        groups.set(key, group);
      }
      return [...groups.values()];
    };
    const sourceLineNames = new Map<string, string>();
    if (submission.template_id) {
      const sourceLines = await tenantDb(trx, tenant).table('contract_template_lines')
        .where({ template_id: submission.template_id }).select('template_line_id', 'template_line_name');
      for (const line of sourceLines) sourceLineNames.set(line.template_line_id, line.template_line_name);
    }
    const assertTemplateSourceLine = (sourceId: string | undefined) => {
      if (sourceId && !sourceLineNames.has(sourceId)) {
        throw new Error('A selected source line does not belong to this contract template. Reload the template before creating the contract.');
      }
    };
    const lineName = (services: Array<{ source_template_line_id?: string }>, fallback: string) => {
      const sourceId = services[0]?.source_template_line_id;
      assertTemplateSourceLine(sourceId);
      return sourceId ? `${submission.contract_name} - ${sourceLineNames.get(sourceId)}` : `${submission.contract_name} - ${fallback}`;
    };
    const productGroups = groupBySourceLine(filteredProductServices);
    const hourlyGroups = groupBySourceLine(filteredHourlyServices);
    const usageGroups = groupBySourceLine(filteredUsageServices);
    let nextDisplayOrder = 0;
  const planServiceConfigService = new ContractLineServiceConfigurationService(trx, tenant);
  // Products allow advance: the products line's own timing, else the contract-wide value.
  const recurringAuthoringPolicy = resolveRecurringAuthoringPolicy({
    lineType: 'Product',
    cadenceOwner: submission.cadence_owner,
    defaultCadenceOwner: DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER,
    billingTiming: submission.product_billing_timing,
    contractWideBillingTiming: submission.billing_timing,
    enableProration: submission.enable_proration,
  });
  // Hourly and Usage lines bill in arrears whatever the contract-wide value is.
  const arrearsOnlyLinePolicy = resolveRecurringAuthoringPolicy({
    lineType: 'Hourly',
    cadenceOwner: submission.cadence_owner,
    defaultCadenceOwner: DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER,
    contractWideBillingTiming: submission.billing_timing,
    enableProration: submission.enable_proration,
  });

    if (templateId) {
      const template = await tenantDb(trx, tenant).table('contract_templates')
        .where({ template_id: templateId })
        .first('template_id', 'template_status');
      // Only published templates can be instantiated (the picker lists only
      // those), so a draft/archived id sent directly is rejected here too.
      if (!template || template.template_status !== 'published') {
        throw new Error('Template not found');
      }

      const templateLineRows = await tenantDb(trx, tenant).table('contract_template_lines')
        .where({ template_id: templateId })
        .orderBy('display_order', 'asc')
        .orderBy('created_at', 'asc')
        .select('template_line_id');

      const editsByTemplateLineId = new Map<string, TemplateLineEdits>();
      for (const lineEdit of Array.isArray(submission.template_lines) ? submission.template_lines : []) {
        if (lineEdit?.template_line_id) {
          editsByTemplateLineId.set(lineEdit.template_line_id, lineEdit);
        }
      }

      // Resolve the template's amounts for the contract currency ONCE; every
      // line clones from this map and never copies an amount across currencies.
      const templateAmounts = await resolveTemplateAmounts(trx, tenant, templateId, contractCurrency);

      const saveTemplateAmounts = submission.save_template_amounts === true && templateAmounts.source !== 'base';
      if (saveTemplateAmounts && !(await hasPermission(user, 'billing', 'update', trx))) {
        throw new Error('Permission denied: Cannot save amounts to the contract template');
      }

      const unpricedServiceNames = new Set<string>();
      const unsetAmountLabels: string[] = [];
      const writtenAmounts: Record<string, number> = {};
      for (const templateLineRow of templateLineRows as Array<{ template_line_id: string }>) {
        // One clone routine (shared with the addContractLine API): every line is
        // copied with its own name/frequency/services/rates/configs; the wizard's
        // edit for this line, if any, is applied on top.
        const cloned = await cloneTemplateLineToContract(trx, tenant, contractId, templateLineRow.template_line_id, {
          currencyCode: contractCurrency,
          edits: editsByTemplateLineId.get(templateLineRow.template_line_id),
          displayOrder: nextDisplayOrder,
          amounts: templateAmounts,
        });
        // Keep the template discount's target identity when cloning a template
        // line directly. The flattened wizard path fills this map as each
        // source line becomes one or more authored lines; template mode must
        // populate it from the clone result before copying line-scoped terms.
        sourceTemplateLineMap[templateLineRow.template_line_id] = cloned.contract_line_id;
        createdContractLineIds.push(cloned.contract_line_id);
        if (!primaryContractLineId) {
          primaryContractLineId = cloned.contract_line_id;
        }
        cloned.unpriced_services.forEach((service) => unpricedServiceNames.add(`"${service.service_name}"`));
        cloned.unset_amounts.forEach((unset) => unsetAmountLabels.push(`"${unset.label}"`));
        Object.assign(writtenAmounts, cloned.written_amounts);
        nextDisplayOrder += 1;
      }

      // Same rule as the flat path: no rate from the template/edit and no price
      // in the contract currency means we do NOT fall back to another currency.
      // Throwing rolls the whole transaction back (drafts too).
      if (unsetAmountLabels.length > 0) {
        throw templateAmountsMissingError(contractCurrency, [...unsetAmountLabels, ...Array.from(unpricedServiceNames)]);
      }
      if (unpricedServiceNames.size > 0) {
        throw currencyPricingMissingError(contractCurrency, Array.from(unpricedServiceNames));
      }

      if (saveTemplateAmounts) {
        // What the contract was actually created with, limited to REQUIRED slots
        // (derived bundle shares re-split on their own).
        const toSave: Record<string, number> = {};
        for (const slot of templateAmounts.slots) {
          if (slot.required && writtenAmounts[slot.slot_key] !== undefined) {
            toSave[slot.slot_key] = writtenAmounts[slot.slot_key];
          }
        }
        await writeTemplatePriceSet(trx, tenant, templateId, contractCurrency, toSave, user.user_id);
      }
    }


    for (const [lineIndex, fixedLine] of writableFixedLines.entries()) {
      assertTemplateSourceLine(fixedLine.source_template_line_id);
      // Per-line timing and proration; cadence owner stays contract-level.
      const fixedLinePolicy = resolveRecurringAuthoringPolicy({
        lineType: 'Fixed',
        cadenceOwner: submission.cadence_owner,
        defaultCadenceOwner: DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER,
        billingTiming: fixedLine.billing_timing,
        contractWideBillingTiming: submission.billing_timing,
        enableProration: fixedLine.enable_proration,
      });
      const createdFixedLine = await ContractLine.create(trx, {
        contract_line_name: resolveFixedLineName(
          submission.contract_name,
          fixedLine,
          lineIndex,
          writableFixedLines.length,
        ),
        description: fixedLine.description ?? null,
        location_id: fixedLine.location_id ?? null,
        billing_frequency: fixedLine.billing_frequency ?? submission.billing_frequency ?? 'monthly',
        is_custom: true,
        service_category: null as any,
        contract_line_type: 'Fixed',
        hourly_rate: null,
        minimum_billable_time: null,
        round_up_to_nearest: null,
        enable_overtime: null,
        overtime_rate: null,
        overtime_threshold: null,
        enable_after_hours_rate: null,
        after_hours_multiplier: null,
        contract_id: contractId,
        display_order: nextDisplayOrder,
        custom_rate: null,
        rate_provenance: 'inherited',
        billing_timing: fixedLinePolicy.billingTiming,
        cadence_owner: fixedLinePolicy.cadenceOwner,
        is_template: false,
      } as any);
      const planId = createdFixedLine.contract_line_id!;
      mapSourceTemplateLine(fixedLine.source_template_line_id, planId);
      createdContractLineIds.push(planId);
      if (!primaryContractLineId) {
        primaryContractLineId = planId;
      }

      // The line base rate is the bundle total and covers ONLY bundle members.
      // A service-less (custom) line keeps its recurring amount on the line itself.
      const { bundleLineBaseRate } = await writeFixedLineMembers(
        trx,
        tenant,
        planServiceConfigService,
        planId,
        fixedLine,
        fixedModeDefaultsByServiceId,
      );

      const fixedConfigModel = new ContractLineFixedConfig(trx, tenant);
      await fixedConfigModel.upsert({
        contract_line_id: planId,
        // No operator rate means "follow the catalog" (null + inherited), not a
        // stored zero that would shadow it forever. Already in cents when set.
        // A line of only unit members has no bundle total at all.
        base_rate: fixedLine.services.length === 0 ? (fixedLine.base_rate ?? null) : bundleLineBaseRate,
        enable_proration: fixedLinePolicy.enableProration,
        billing_cycle_alignment: fixedLinePolicy.billingCycleAlignment,
        tenant,
      });

      nextDisplayOrder += 1;
    }

    for (const productServices of productGroups) {
      const createdProductsLine = await ContractLine.create(trx, {
        contract_line_name: lineName(productServices, 'Products'),
        billing_frequency: submission.billing_frequency ?? 'monthly',
        is_custom: true,
        service_category: null as any,
        contract_line_type: 'Fixed',
        contract_id: contractId,
        display_order: nextDisplayOrder,
        custom_rate: null,
        billing_timing: recurringAuthoringPolicy.billingTiming,
        cadence_owner: recurringAuthoringPolicy.cadenceOwner,
        is_template: false,
      } as any);
      const productsLineId = createdProductsLine.contract_line_id!;
      createdContractLineIds.push(productsLineId);
      if (!primaryContractLineId) {
        primaryContractLineId = productsLineId;
      }

      for (const product of productServices) {
        mapSourceTemplateLine(product.source_template_line_id, productsLineId);
        const quantity = product.quantity ?? 1;
        const customRate = product.custom_rate !== undefined ? Math.round(Number(product.custom_rate) || 0) : undefined;

        await tenantDb(trx, tenant).table('contract_line_services').insert({
          tenant,
          contract_line_id: productsLineId,
          service_id: product.service_id,
        });

        await planServiceConfigService.createConfiguration(
          {
            contract_line_id: productsLineId,
            service_id: product.service_id,
            configuration_type: 'Fixed',
            quantity,
            tenant,
            custom_rate: customRate,
          },
          // No placeholder zero: absent a member rate the catalog price in the
          // contract currency resolves (the engine's chain), and a stored 0
          // 'bundle' base_rate would shadow it in readers. The basis is 'unit'
          // because that is how the engine bills a product member (quantity x
          // resolved rate, never a share of a line total) -- 'bundle' made the
          // UI call the seat count "an allocation of the bundle price". The
          // engine and valuation never branch on a product's pricing_basis.
          { base_rate: null, rate_provenance: 'inherited', pricing_basis: 'unit' }
        );
      }

      const fixedConfigModel = new ContractLineFixedConfig(trx, tenant);
      await fixedConfigModel.upsert({
        contract_line_id: productsLineId,
        // NULL = no line override. A line-level 0 is read as a price by anything
        // that reads contract_lines.custom_rate directly.
        base_rate: null,
        enable_proration: recurringAuthoringPolicy.enableProration,
        billing_cycle_alignment: recurringAuthoringPolicy.billingCycleAlignment,
        tenant,
      });

      nextDisplayOrder += 1;
    }

    for (const hourlyServices of hourlyGroups) {
      const createdHourlyLine = await ContractLine.create(trx, {
        contract_line_name: lineName(hourlyServices, 'Hourly'),
        billing_frequency: submission.hourly_billing_frequency ?? submission.billing_frequency ?? 'monthly',
        is_custom: true,
        service_category: null as any,
        contract_line_type: 'Hourly',
        minimum_billable_time: submission.minimum_billable_time ?? 15,
        round_up_to_nearest: submission.round_up_to_nearest ?? 15,
        contract_id: contractId,
        display_order: nextDisplayOrder,
        custom_rate: null,
        billing_timing: arrearsOnlyLinePolicy.billingTiming,
        cadence_owner: arrearsOnlyLinePolicy.cadenceOwner,
        is_template: false,
      } as any);
      const hourlyPlanId = createdHourlyLine.contract_line_id!;
      poolLines.hourly.push({ lineId: hourlyPlanId, serviceIds: new Set(hourlyServices.map((service) => service.service_id)) });
      createdContractLineIds.push(hourlyPlanId);
      if (!primaryContractLineId) {
        primaryContractLineId = hourlyPlanId;
      }

      for (const service of hourlyServices) {
        mapSourceTemplateLine(service.source_template_line_id, hourlyPlanId);
        const normalizedHourlyRate =
          firstPositiveRateInCents(
            service.hourly_rate,
            hourlyModeDefaultsByServiceId.get(service.service_id),
            serviceCatalogById.get(service.service_id)?.default_rate
          ) ?? 0;
        await tenantDb(trx, tenant).table('contract_line_services').insert({
          tenant,
          contract_line_id: hourlyPlanId,
          service_id: service.service_id,
        });

        await planServiceConfigService.upsertPlanServiceHourlyConfiguration(hourlyPlanId, service.service_id, {
          hourly_rate: normalizedHourlyRate,
          minimum_billable_time: submission.minimum_billable_time ?? 15,
          round_up_to_nearest: submission.round_up_to_nearest ?? 15,
        });

        if (service.bucket_overlay) {
          await upsertBucketOverlayInTransaction(
            trx,
            tenant,
            hourlyPlanId,
            service.service_id,
            service.bucket_overlay,
            null,
            null
          );
        }
      }

      nextDisplayOrder += 1;
    }

    for (const usageServices of usageGroups) {
      const createdUsageLine = await ContractLine.create(trx, {
        contract_line_name: lineName(usageServices, 'Usage'),
        billing_frequency: submission.usage_billing_frequency ?? submission.billing_frequency ?? 'monthly',
        is_custom: true,
        service_category: null as any,
        contract_line_type: 'Usage',
        contract_id: contractId,
        display_order: nextDisplayOrder,
        custom_rate: null,
        billing_timing: arrearsOnlyLinePolicy.billingTiming,
        cadence_owner: arrearsOnlyLinePolicy.cadenceOwner,
        is_template: false,
      } as any);
      const usagePlanId = createdUsageLine.contract_line_id!;
      poolLines.usage.push({ lineId: usagePlanId, serviceIds: new Set(usageServices.map((service) => service.service_id)) });
      createdContractLineIds.push(usagePlanId);
      if (!primaryContractLineId) {
        primaryContractLineId = usagePlanId;
      }

      for (const service of usageServices) {
        mapSourceTemplateLine(service.source_template_line_id, usagePlanId);
        const normalizedUnitRate =
          firstPositiveRateInCents(
            service.unit_rate,
            usageModeDefaultsByServiceId.get(service.service_id),
            serviceCatalogById.get(service.service_id)?.default_rate
          ) ?? 0;
        await tenantDb(trx, tenant).table('contract_line_services').insert({
          tenant,
          contract_line_id: usagePlanId,
          service_id: service.service_id,
        });

        await planServiceConfigService.upsertPlanServiceUsageConfiguration(usagePlanId, service.service_id, {
          unit_of_measure: service.unit_of_measure || resolveUnitOfMeasure({ fallback: 'C62' }).label,
          unit_rate: normalizedUnitRate,
          enable_tiered_pricing: false,
        });

        if (service.bucket_overlay) {
          await upsertBucketOverlayInTransaction(
            trx,
            tenant,
            usagePlanId,
            service.service_id,
            service.bucket_overlay,
            null,
            null
          );
        }
      }

      nextDisplayOrder += 1;
    }

    // Prepaid Block lines: each entry is its own Hourly line (never merged with the plain hourly
    // line) plus one contract_line_prepaid_blocks row. The config upsert validates the line (Hourly,
    // no pools, every covered service has an hourly rate > 0) and syncs its issuances; the contract
    // currency is already pinned on the contract row, so prices are interpreted in that currency.
    for (const [blockIndex, entry] of prepaidBlockLineInputs.entries()) {
      const blockLine = await ContractLine.create(trx, {
        contract_line_name:
          entry.name?.trim() ||
          (prepaidBlockLineInputs.length > 1
            ? `${submission.contract_name} - Prepaid Block ${blockIndex + 1}`
            : `${submission.contract_name} - Prepaid Block`),
        billing_frequency: submission.hourly_billing_frequency ?? submission.billing_frequency ?? 'monthly',
        is_custom: true,
        service_category: null as any,
        contract_line_type: 'Hourly',
        minimum_billable_time: submission.minimum_billable_time ?? 15,
        round_up_to_nearest: submission.round_up_to_nearest ?? 15,
        contract_id: contractId,
        display_order: nextDisplayOrder,
        custom_rate: null,
        // Line stays arrears; the block fee goes in advance via its prepaid_block charge stream.
        billing_timing: arrearsOnlyLinePolicy.billingTiming,
        cadence_owner: arrearsOnlyLinePolicy.cadenceOwner,
        is_template: false,
      } as any);
      const blockLineId = blockLine.contract_line_id!;
      createdContractLineIds.push(blockLineId);
      if (!primaryContractLineId) {
        primaryContractLineId = blockLineId;
      }

      for (const service of entry.services) {
        const normalizedHourlyRate =
          firstPositiveRateInCents(
            service.hourly_rate,
            hourlyModeDefaultsByServiceId.get(service.service_id),
            serviceCatalogById.get(service.service_id)?.default_rate
          ) ?? 0;
        await tenantDb(trx, tenant).table('contract_line_services').insert({
          tenant,
          contract_line_id: blockLineId,
          service_id: service.service_id,
        });
        await planServiceConfigService.upsertPlanServiceHourlyConfiguration(blockLineId, service.service_id, {
          hourly_rate: normalizedHourlyRate,
          minimum_billable_time: submission.minimum_billable_time ?? 15,
          round_up_to_nearest: submission.round_up_to_nearest ?? 15,
        });
      }

      await upsertContractLinePrepaidBlockInTransaction(trx, tenant, blockLineId, entry.block);
      nextDisplayOrder += 1;
    }

    // Flag-on line-level bucket pools: materialize the wizard's pool drafts
    // (weighted-burn model) onto the line the draft was authored for, after
    // that line exists. Drafts whose line was not created (no services) are
    // skipped — a pool without its member line cannot carry members.
    const poolDrafts = !templateId && Array.isArray(submission.bucket_pools) ? submission.bucket_pools : [];
    if (poolDrafts.length > 0) {
      for (const draft of poolDrafts) {
        const typeLines = poolLines[draft.line_key ?? 'hourly'] ?? [];
        if (typeLines.length === 0) continue;
        const candidates = typeLines.filter((line) =>
          (draft.members ?? []).every((member) => line.serviceIds.has(member.service_id)));
        if (candidates.length !== 1 || (draft.covers_all_services && typeLines.length > 1)) {
          throw new Error('This bucket pool spans multiple template lines. Create the contract without this pool, then configure a separate pool on each contract line.');
        }
        const targetLineId = candidates[0].lineId;
        await createBucketPoolInTransaction(
          trx,
          tenant,
          targetLineId,
          {
            bucket_name: draft.bucket_name ?? null,
            total_minutes: Math.max(0, Math.round(draft.total_minutes)),
            overage_rate: Math.max(0, Math.round(draft.overage_rate)),
            allow_rollover: draft.allow_rollover,
            covers_all_services: draft.covers_all_services ?? false,
            after_hours_multiplier: draft.after_hours_multiplier ?? null,
            business_hours_schedule_id: draft.business_hours_schedule_id ?? null,
          },
          // Member rows are multiplier overrides under a catch-all, so the
          // draft's members are preserved regardless of scope.
          draft.members,
        );
      }
    }

    // Guard (existing drafts only): the rebuilt contract must bill what the saved one did, unless the
    // user has seen and acknowledged the server-computed change. Throwing rolls the transaction back.
    if (existingContractId && baselineMonthlyCents !== null) {
      const resultingMonthlyCents =
        (await getContractMonthlyFixedValuesByContract(trx, tenant, [existingContractId])).get(existingContractId)
          ?.monthlyValueCents ?? 0;
      if (
        resultingMonthlyCents !== baselineMonthlyCents &&
        submission.recurring_change_ack?.baseline_monthly_cents !== baselineMonthlyCents
      ) {
        throw new RecurringTotalChangeRequiresConfirmation(baselineMonthlyCents, resultingMonthlyCents);
      }
    }

    const clientContractAssignment = await createClientContractAssignment(trx, tenant, {
      client_id: submission.client_id,
      contract_id: contractId,
      template_contract_id: templateId,
      start_date: startDate,
      end_date: endDate,
      is_active: !isDraft,
      renewal_mode:
        submission.renewal_mode === 'none' ||
        submission.renewal_mode === 'manual' ||
        submission.renewal_mode === 'auto'
          ? submission.renewal_mode
          : 'manual',
      notice_period_days:
        Number.isInteger(submission.notice_period_days) && (submission.notice_period_days as number) >= 0
          ? Number(submission.notice_period_days)
          : 30,
      renewal_term_months:
        Number.isInteger(submission.renewal_term_months) && (submission.renewal_term_months as number) > 0
          ? Number(submission.renewal_term_months)
          : undefined,
      use_tenant_renewal_defaults:
        typeof submission.use_tenant_renewal_defaults === 'boolean'
          ? submission.use_tenant_renewal_defaults
          : true,
      po_required: submission.po_required ?? false,
      po_number: submission.po_number ?? null,
      po_amount: submission.po_amount ?? null,
      billing_profile_id: submission.billing_profile_id ?? null,
    });
    if (submission.template_id) {
      await cloneTemplateDefaultDiscounts(trx, {
        tenant,
        templateId: submission.template_id,
        clientContractId: clientContractAssignment.client_contract_id,
        clientId: submission.client_id,
        lineIdMap: sourceTemplateLineMap,
      });
    }

    // Wizard-authored contract-wide discounts become this client contract's own
    // definitions, the same independently owned shape the Discounts tab edits.
    // A draft save carries none, so resuming a draft never meets standing terms
    // the rebuild would orphan.
    if (!isDraft) {
      await createWizardContractDiscounts(trx, tenant, {
        clientContractId: clientContractAssignment.client_contract_id,
        discounts: submission.discounts ?? [],
      });
    }

    if (!isDraft) {
      // LEVERAGE: pattern line-obligation-sync — prepaid block issuances follow the same line-obligation changes as recurring service periods
      await syncRecurringServicePeriodsForContract(trx, {
        tenant,
        contractId,
        sourceRunPrefix: 'contract_wizard_save',
      });
      await syncPrepaidBlockIssuancesForContract(trx, tenant, contractId);
    }

    createdForWorkflow = {
      contractId,
      clientContractId: clientContractAssignment.client_contract_id,
      clientId: submission.client_id,
      createdAt: now.toISOString(),
      startDate,
      endDate,
      status: isDraft ? 'draft' : 'active',
      actorUserId: typeof user?.user_id === 'string' ? user.user_id : undefined,
    };

    const decisionDueAtForWorkflow =
      endDate && Number.isInteger(submission.notice_period_days) && (submission.notice_period_days as number) >= 0
        ? new Date(
          new Date(`${endDate}T00:00:00.000Z`).getTime() -
            Math.trunc(submission.notice_period_days as number) * 24 * 60 * 60 * 1000
        ).toISOString().slice(0, 10)
        : endDate;
    renewalForWorkflow = endDate
      ? computeContractRenewalUpcoming({
          renewalAt: endDate,
          decisionDueAt: clientContractAssignment.decision_due_date ?? decisionDueAtForWorkflow ?? undefined,
          renewalCycleKey: clientContractAssignment.renewal_cycle_key ?? undefined,
          now: now.toISOString(),
        })
      : null;

    // NOTE: The legacy per-client line replication path has been removed.
    // The client_contract_lines, client_contract_services, and related tables are
    // redundant since contracts are already client-specific via client_contracts.
    // The billing engine reads from contract_lines directly.

    return {
      contract_id: contractId,
      contract_line_id: primaryContractLineId,
      contract_line_ids: createdContractLineIds,
    };
  });

  if (createdForWorkflow) {
    const wfData: {
      contractId: string;
      clientContractId: string;
      clientId: string;
      createdAt: string;
      startDate: string;
      endDate: string | null;
      status: string;
      actorUserId?: string;
    } = createdForWorkflow;
    await publishWorkflowEvent({
      eventType: 'CONTRACT_CREATED',
      payload: buildContractCreatedPayload({
        contractId: wfData.contractId,
        clientId: wfData.clientId,
        createdByUserId: wfData.actorUserId,
        createdAt: wfData.createdAt,
        startDate: wfData.startDate,
        endDate: wfData.endDate,
        status: wfData.status,
      }),
      ctx: {
        tenantId: tenant,
        occurredAt: wfData.createdAt,
        actor: wfData.actorUserId
          ? { actorType: 'USER' as const, actorUserId: wfData.actorUserId }
          : undefined,
      },
      idempotencyKey: `contract_created:${wfData.contractId}:${wfData.clientId}`,
    });

    if (renewalForWorkflow) {
      const renewal: {
        renewalAt: string;
        decisionDueDate: string;
        daysUntilRenewal: number;
        daysUntilDecisionDue: number;
        renewalCycleKey?: string;
      } = renewalForWorkflow as any;
      await emitDateDomainEventOnce(knex, tenant, {
        eventType: 'CONTRACT_RENEWAL_UPCOMING', entityId: wfData.clientContractId,
        cycleKey: renewal.renewalCycleKey ?? normalizeDateDomainKeyDate(renewal.decisionDueDate ?? renewal.renewalAt),
        occursOn: normalizeDateDomainKeyDate(renewal.decisionDueDate),
        payload: buildContractRenewalUpcomingPayload({
          contractId: wfData.contractId,
          clientId: wfData.clientId,
          renewalAt: normalizeDateDomainKeyDate(renewal.renewalAt),
          decisionDueDate: normalizeDateDomainKeyDate(renewal.decisionDueDate),
          daysUntilRenewal: renewal.daysUntilRenewal,
          daysUntilDecisionDue: renewal.daysUntilDecisionDue,
          renewalCycleKey: renewal.renewalCycleKey,
        }),
        ctx: {
          tenantId: tenant,
          occurredAt: wfData.createdAt,
          actor: wfData.actorUserId
            ? { actorType: 'USER' as const, actorUserId: wfData.actorUserId }
            : undefined,
        },
      });
    }
  }

  return result;
  } catch (error) {
    if (error instanceof RecurringTotalChangeRequiresConfirmation) {
      return {
        confirmation_required: 'recurring_total_change',
        baseline_monthly_cents: error.baselineMonthlyCents,
        resulting_monthly_cents: error.resultingMonthlyCents,
      };
    }
    const expected = contractWizardActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

// ---------------------------------------------------------------------------
// Template name validation
// ---------------------------------------------------------------------------

export const checkTemplateNameExists = withAuth(async (
  user,
  { tenant },
  templateName: string
): Promise<boolean> => {
  const { knex } = await createTenantKnex();

  const existingTemplate = await tenantDb(knex, tenant).table('contract_templates')
    .whereRaw('LOWER(template_name) = LOWER(?)', [templateName.trim()])
    .first();

  return !!existingTemplate;
});

// ---------------------------------------------------------------------------
// Template helper queries for client wizard
// ---------------------------------------------------------------------------

export const listContractTemplatesForWizard = withAuth(async (
  user,
  { tenant }
): Promise<TemplateOption[] | ContractWizardActionError> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    return permissionError('Permission denied: Cannot list contract templates', 'msp/contracts:errors.wizard.permissions.listTemplates');
  }
  const { knex } = await createTenantKnex();

  // Only published templates are offered; drafts are still being authored.
  const templates = await tenantDb(knex, tenant).table('contract_templates')
    .where({ template_status: 'published' })
    .orderBy('template_name', 'asc')
    .select(
      'template_id',
      'template_name',
      'template_description',
      'default_billing_frequency',
      'currency_code'
    );

  const currencies = await listTemplateCurrencies(
    knex,
    tenant,
    templates.map((template) => template.template_id),
  );

  return templates.map((template) => {
    const summary = currencies.get(template.template_id);
    return {
      contract_id: template.template_id,
      contract_name: template.template_name,
      contract_description: template.template_description,
      billing_frequency: template.default_billing_frequency,
      currency_code: summary?.base ?? template.currency_code,
      price_set_currencies: summary?.sets ?? [],
      incomplete_set_currencies: summary?.incomplete_sets ?? [],
    };
  });
});

type LineServicesWithConfig = Awaited<ReturnType<typeof getContractLineServicesWithConfigurations>>;

const bucketOverlayFromConfig = (bucketConfig: unknown): BucketOverlayInput | undefined =>
  bucketConfig && isBucketConfig(bucketConfig as any)
    ? {
        total_minutes: (bucketConfig as any).total_minutes ?? undefined,
        overage_rate:
          (bucketConfig as any).overage_rate != null ? Math.round(Number((bucketConfig as any).overage_rate)) : undefined,
        allow_rollover: Boolean((bucketConfig as any).allow_rollover),
        billing_period: (bucketConfig as any).billing_period === 'weekly' ? 'weekly' : 'monthly',
      }
    : undefined;

/**
 * Maps ONE stored `Fixed` line to one wizard fixed line, keeping the line's own
 * rate, frequency, timing, proration, name, description and location. Product
 * members are returned separately (the wizard keeps them in `product_services`).
 *
 * Returns `fixedLine: null` for a line that only holds products. A line with no
 * members and a stored `custom_rate` (what quote conversion writes for a
 * service-less recurring item) comes back as a line with `services: []`.
 */
function mapStoredFixedLineToWizard(
  line: { contract_line_id: string; contract_line_name?: string; description?: string | null; location_id?: string | null;
    billing_frequency?: string; billing_timing?: 'arrears' | 'advance'; enable_proration?: boolean; rate?: number | null },
  members: LineServicesWithConfig,
  options: { missingUnitRate: null | undefined; includeLocation: boolean },
): { fixedLine: ContractWizardFixedLine | null; products: Array<{ service_id: string; service_name?: string; quantity: number; custom_rate?: number }> } {
  const products: Array<{ service_id: string; service_name?: string; quantity: number; custom_rate?: number }> = [];
  const services: ContractWizardFixedService[] = [];

  for (const { service, configuration, typeConfig, bucketConfig } of members) {
    const quantity = configuration?.quantity != null ? Number(configuration.quantity) : 1;
    if (service.item_kind === 'product') {
      products.push({
        service_id: service.service_id,
        service_name: service.service_name,
        quantity,
        custom_rate: configuration?.custom_rate != null ? Math.round(Number(configuration.custom_rate)) : undefined,
      });
      continue;
    }

    // Reload the stored basis and unit rate: a draft that resumed without
    // them would silently demote a per-seat service to an allocation.
    const fixedTypeConfig =
      typeConfig && 'pricing_basis' in typeConfig ? (typeConfig as IContractLineServiceFixedConfig) : null;
    const isUnit = fixedTypeConfig?.pricing_basis === 'unit';
    services.push({
      service_id: service.service_id,
      service_name: service.service_name,
      quantity,
      pricing_basis: isUnit ? 'unit' : 'bundle',
      unit_rate: isUnit && fixedTypeConfig?.base_rate != null ? Math.round(Number(fixedTypeConfig.base_rate)) : options.missingUnitRate,
      bucket_overlay: bucketOverlayFromConfig(bucketConfig),
    });
  }

  const isServiceLessCustomLine = members.length === 0 && line.rate != null;
  if (services.length === 0 && !isServiceLessCustomLine) {
    return { fixedLine: null, products };
  }

  // A pure per-seat line has no bundle total: its stored 0 must not prefill the base rate.
  const hasBundle = hasBundleFixedService(services);
  const baseRate =
    (hasBundle || isServiceLessCustomLine) && line.rate != null ? Math.round(Number(line.rate)) : null;

  return {
    products,
    fixedLine: {
      line_key: line.contract_line_id,
      source_contract_line_id: line.contract_line_id,
      contract_line_name: line.contract_line_name,
      description: line.description ?? null,
      ...(options.includeLocation ? { location_id: line.location_id ?? null } : {}),
      billing_frequency: line.billing_frequency,
      billing_timing: line.billing_timing,
      enable_proration: Boolean(line.enable_proration),
      base_rate: baseRate,
      services,
    },
  };
}

export const getContractTemplateLinesForClientWizard = withAuth(async (
  user,
  { tenant },
  templateId: string,
  clientId?: string
): Promise<ClientTemplateLinesView | ContractWizardActionError> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    return permissionError('Permission denied: Cannot view contract template snapshot', 'msp/contracts:errors.wizard.permissions.viewSnapshot');
  }
  const { knex } = await createTenantKnex();

  const template = await tenantDb(knex, tenant).table('contract_templates')
    .where({ template_id: templateId })
    .first();

  if (!template) {
    return actionError('Template not found', 'msp/contracts:errors.wizard.templateNotFound');
  }

  // Rates are shown in the currency the contract will be created in: the
  // client's when known, otherwise the tenant default. Never a hardcoded USD.
  const currencyCode = clientId
    ? await resolveClientContractCurrency(knex, tenant, clientId)
    : (await tenantDb(knex, tenant).table('default_billing_settings')
        .select('default_currency_code')
        .first())?.default_currency_code || 'USD';

  const amounts = await resolveTemplateAmounts(knex, tenant, templateId, currencyCode);
  const lines = await fetchTemplateLineViews(knex, tenant, templateId, currencyCode, amounts);

  return {
    template_id: templateId,
    contract_name: template.template_name,
    description: template.template_description,
    billing_frequency: template.default_billing_frequency,
    currency_code: currencyCode,
    template_currency: amounts.template_currency,
    amount_source: amounts.source,
    can_save_template_amounts: await hasPermission(user, 'billing', 'update'),
    lines,
  };
});

export type DraftContractWizardData = {
  client_id: string;
  billing_profile_id?: string | null;
  contract_name: string;
  start_date: string;
  end_date?: string;
  renewal_mode?: 'none' | 'manual' | 'auto';
  notice_period_days?: number;
  renewal_term_months?: number;
  use_tenant_renewal_defaults?: boolean;
  cadence_owner?: CadenceOwner;
  billing_timing?: 'arrears' | 'advance';
  description?: string;
  billing_frequency: string;
  currency_code: string;
  po_number?: string;
  po_amount?: number;
  po_required?: boolean;
  fixed_lines: ContractWizardFixedLine[];
  /** Set only when the stored products line's timing differs from the contract default; unset = inherit. */
  product_billing_timing?: 'arrears' | 'advance';
  product_services: Array<{
    service_id: string;
    service_name?: string;
    quantity: number;
    custom_rate?: number;
  }>;
  enable_proration: boolean;
  /** The server's monthly fixed value for this draft as saved; compared against on finalize. */
  recurring_baseline?: { monthly_cents: number };
  hourly_services: Array<{
    service_id: string;
    service_name?: string;
    hourly_rate?: number;
    bucket_overlay?: BucketOverlayInput | null;
  }>;
  hourly_billing_frequency?: string;
  minimum_billable_time?: number;
  round_up_to_nearest?: number;
  /** Hourly lines that carry a Prepaid Block config, round-tripped whole (config included). */
  prepaid_block_lines?: ClientPrepaidBlockLineInput[];
  usage_services: Array<{
    service_id: string;
    service_name?: string;
    unit_rate?: number;
    unit_of_measure?: string;
    bucket_overlay?: BucketOverlayInput | null;
  }>;
  usage_billing_frequency?: string;
  contract_id: string;
  is_draft: true;
  template_id?: string;
  /**
   * Per-line edits rebuilt from the saved (already cloned) lines for a
   * template-derived draft, so resuming and re-saving does not revert edits.
   * Absent when the saved lines can no longer be paired with the template's.
   */
  template_lines?: ClientTemplateLineEditInput[];
};

export const getDraftContractForResume = withAuth(async (
  user,
  { tenant },
  contractId: string
): Promise<DraftContractWizardData | ContractWizardActionError> => {
  const isBypass = process.env.E2E_AUTH_BYPASS === 'true';

  if (!isBypass) {
    const canCreateBilling = await hasPermission(user, 'billing', 'create');
    const canUpdateBilling = await hasPermission(user, 'billing', 'update');
    if (!canCreateBilling || !canUpdateBilling) {
      return permissionError('Permission denied: Cannot resume billing contracts', 'msp/contracts:errors.wizard.permissions.resumeContracts');
    }
  }

  const { knex } = await createTenantKnex();

  const contract = await tenantDb(knex, tenant).table('contracts')
    .where({ contract_id: contractId })
    .andWhere((builder) => builder.whereNull('is_template').orWhere('is_template', false))
    .first();

  if (!contract) {
    return actionError('Contract not found', 'msp/contracts:errors.wizard.contractNotFound');
  }

  if (contract.status !== 'draft') {
    return actionError('Contract is not a draft', 'msp/contracts:errors.wizard.notDraft');
  }

  const clientContract = await tenantDb(knex, tenant).table('client_contracts')
    .where({ contract_id: contractId })
    .first();

  if (!clientContract) {
    return actionError('Draft contract is missing client assignment', 'msp/contracts:errors.wizard.missingClient');
  }

  const detailedLines = await fetchDetailedContractLines(knex, tenant, contractId);

  const fixedLines: ContractWizardFixedLine[] = [];
  const storedLines: StoredRecurringLine[] = [];
  const productServices: DraftContractWizardData['product_services'] = [];
  const hourlyServices: DraftContractWizardData['hourly_services'] = [];
  const usageServices: DraftContractWizardData['usage_services'] = [];
  let minimumBillableTime: number | undefined;
  let roundUpToNearest: number | undefined;
  let enableProration = false;
  let hourlyBillingFrequency: string | undefined;
  let usageBillingFrequency: string | undefined;
  let cadenceOwner: CadenceOwner = 'client';
  let billingTiming: 'arrears' | 'advance' = 'arrears';
  let storedProductsTiming: 'arrears' | 'advance' | undefined;
  const servicesByLineId = new Map<
    string,
    Awaited<ReturnType<typeof getContractLineServicesWithConfigurations>>
  >();
  const hourlyServiceIds: string[] = [];
  const usageServiceIds: string[] = [];

  for (const line of detailedLines) {
    const servicesWithConfig = await getContractLineServicesWithConfigurations(line.contract_line_id);
    servicesByLineId.set(line.contract_line_id, servicesWithConfig);

    if (line.contract_line_type === 'Hourly') {
      hourlyServiceIds.push(...servicesWithConfig.map(({ service }) => service.service_id));
    } else if (line.contract_line_type === 'Usage') {
      usageServiceIds.push(...servicesWithConfig.map(({ service }) => service.service_id));
    }
  }

  const prepaidConfigRows = detailedLines.length
    ? ((await tenantDb(knex, tenant).table('contract_line_prepaid_blocks')
        .whereIn('contract_line_id', detailedLines.map((l) => l.contract_line_id))
        .select('*')) as Array<Record<string, any>>)
    : [];
  const prepaidConfigByLineId = new Map(prepaidConfigRows.map((row) => [row.contract_line_id as string, row]));
  const prepaidBlockLines: ClientPrepaidBlockLineInput[] = [];

  const contractCurrencyCode = contract.currency_code || 'USD';
  const hourlyModeDefaultsByServiceId = await fetchModeDefaultRatesByServiceId(
    knex,
    tenant,
    hourlyServiceIds,
    'Hourly',
    contractCurrencyCode
  );
  const usageModeDefaultsByServiceId = await fetchModeDefaultRatesByServiceId(
    knex,
    tenant,
    usageServiceIds,
    'Usage',
    contractCurrencyCode
  );

  // Cadence owner comes from the first non-fixed line when there is one, else the first fixed
  // line, instead of whichever line happens to be last. Billing timing is only a real choice on
  // Fixed lines (Hourly/Usage always bill in arrears), so it is derived from Fixed lines first.
  const linesByPrecedence = [
    ...detailedLines.filter((l) => l.contract_line_type !== 'Fixed'),
    ...detailedLines.filter((l) => l.contract_line_type === 'Fixed'),
  ];
  cadenceOwner = linesByPrecedence.find((l) => l.cadence_owner)?.cadence_owner ?? cadenceOwner;
  billingTiming =
    [...detailedLines.filter((l) => l.contract_line_type === 'Fixed'), ...detailedLines]
      .find((l) => l.billing_timing)?.billing_timing ?? billingTiming;

  for (const line of detailedLines) {
    const servicesWithConfig = servicesByLineId.get(line.contract_line_id) ?? [];

    // A Prepaid Block line is not part of the plain hourly line (and not a recurring-shape line):
    // it resumes as its own entry with its config so re-saving rebuilds it faithfully.
    const prepaidConfig = line.contract_line_type === 'Hourly' ? prepaidConfigByLineId.get(line.contract_line_id) : undefined;
    if (prepaidConfig) {
      prepaidBlockLines.push({
        name: line.contract_line_name,
        services: servicesWithConfig.map(({ service, configuration, typeConfig }) => ({
          service_id: service.service_id,
          service_name: service.service_name,
          hourly_rate: firstPositiveRateInCents(
            isHourlyConfig(typeConfig) ? typeConfig.hourly_rate : undefined,
            configuration?.custom_rate,
            hourlyModeDefaultsByServiceId.get(service.service_id),
            service.default_rate
          ),
        })),
        block: {
          issue_mode: prepaidConfig.issue_mode ?? 'consumption',
          rollover_periods: Number(prepaidConfig.rollover_periods ?? 0),
          block_minutes: Number(prepaidConfig.block_minutes),
          block_price: Number(prepaidConfig.block_price),
          sold_as_service_id: prepaidConfig.sold_as_service_id ?? null,
          expiry_months: prepaidConfig.expiry_months ?? null,
          trigger_on_exhaustion: Boolean(prepaidConfig.trigger_on_exhaustion),
          trigger_threshold_percent: prepaidConfig.trigger_threshold_percent ?? null,
          trigger_on_expiry: Boolean(prepaidConfig.trigger_on_expiry),
          trigger_on_renewal: Boolean(prepaidConfig.trigger_on_renewal),
          replenishment_tier: prepaidConfig.replenishment_tier,
        },
      });
      continue;
    }

    storedLines.push({
      contract_line_id: line.contract_line_id,
      contract_line_name: line.contract_line_name,
      contract_line_type: line.contract_line_type,
      billing_frequency: line.billing_frequency,
      billing_timing: line.billing_timing,
      cadence_owner: line.cadence_owner,
      location_id: line.location_id ?? null,
      enable_proration: Boolean(line.enable_proration),
      custom_rate: line.rate != null ? Math.round(Number(line.rate)) : null,
      members: servicesWithConfig.map(({ service, configuration, typeConfig, bucketConfig }) => {
        const fixedTypeConfig =
          typeConfig && 'pricing_basis' in typeConfig ? (typeConfig as IContractLineServiceFixedConfig) : null;
        const hourlyCfg = isHourlyConfig(typeConfig) ? typeConfig : null;
        const usageCfg = isUsageConfig(typeConfig) ? typeConfig : null;
        const resolvedRate =
          line.contract_line_type === 'Hourly'
            ? firstPositiveRateInCents(
                hourlyCfg?.hourly_rate,
                configuration?.custom_rate,
                hourlyModeDefaultsByServiceId.get(service.service_id),
                service.default_rate
              )
            : line.contract_line_type === 'Usage'
              ? firstPositiveRateInCents(
                  usageCfg?.base_rate,
                  configuration?.custom_rate,
                  usageModeDefaultsByServiceId.get(service.service_id),
                  service.default_rate
                )
              : null;
        return {
          service_id: service.service_id,
          service_name: service.service_name,
          item_kind: service.item_kind,
          quantity: configuration?.quantity != null ? Number(configuration.quantity) : 1,
          custom_rate: configuration?.custom_rate != null ? Math.round(Number(configuration.custom_rate)) : null,
          pricing_basis: fixedTypeConfig?.pricing_basis ?? null,
          unit_rate: fixedTypeConfig?.base_rate != null ? Math.round(Number(fixedTypeConfig.base_rate)) : null,
          resolved_rate: resolvedRate ?? null,
          minimum_billable_time: hourlyCfg?.minimum_billable_time != null ? Number(hourlyCfg.minimum_billable_time) : null,
          round_up_to_nearest: hourlyCfg?.round_up_to_nearest != null ? Number(hourlyCfg.round_up_to_nearest) : null,
          unit_of_measure: usageCfg?.unit_of_measure || service.unit_of_measure || null,
          bucket: bucketOverlayFromConfig(bucketConfig) ?? null,
        };
      }),
    });

    if (line.contract_line_type === 'Fixed') {
      // One wizard fixed line per stored Fixed line; nothing is merged or last-wins.
      const mapped = mapStoredFixedLineToWizard(
        { ...line, rate: line.rate != null ? Number(line.rate) : null },
        servicesWithConfig,
        { missingUnitRate: undefined, includeLocation: true },
      );
      productServices.push(...mapped.products);
      if (mapped.products.length > 0 && line.billing_timing) {
        storedProductsTiming = line.billing_timing as 'arrears' | 'advance';
      }
      if (mapped.fixedLine) {
        fixedLines.push(mapped.fixedLine);
        enableProration = enableProration || mapped.fixedLine.enable_proration;
      }
    } else if (line.contract_line_type === 'Hourly') {
      hourlyBillingFrequency = line.billing_frequency ?? hourlyBillingFrequency;
      servicesWithConfig.forEach(({ service, configuration, typeConfig, bucketConfig }) => {
        const hourlyConfig = isHourlyConfig(typeConfig) ? typeConfig : null;
        const hourlyRateCents = firstPositiveRateInCents(
          hourlyConfig?.hourly_rate,
          configuration?.custom_rate,
          hourlyModeDefaultsByServiceId.get(service.service_id),
          service.default_rate
        );

        const minimumBillable =
          hourlyConfig && hourlyConfig.minimum_billable_time != null
            ? Number(hourlyConfig.minimum_billable_time)
            : minimumBillableTime;
        const roundUp =
          hourlyConfig && hourlyConfig.round_up_to_nearest != null
            ? Number(hourlyConfig.round_up_to_nearest)
            : roundUpToNearest;
        minimumBillableTime = minimumBillable;
        roundUpToNearest = roundUp;

        hourlyServices.push({
          service_id: service.service_id,
          service_name: service.service_name,
          hourly_rate: hourlyRateCents,
          bucket_overlay:
            bucketConfig && isBucketConfig(bucketConfig)
              ? {
                  total_minutes: bucketConfig.total_minutes ?? undefined,
                  overage_rate:
                    bucketConfig.overage_rate != null ? Math.round(Number(bucketConfig.overage_rate)) : undefined,
                  allow_rollover: Boolean(bucketConfig.allow_rollover),
                  billing_period: bucketConfig.billing_period === 'weekly' ? 'weekly' : 'monthly',
                }
              : undefined,
        });
      });
    } else if (line.contract_line_type === 'Usage') {
      usageBillingFrequency = line.billing_frequency ?? usageBillingFrequency;
      servicesWithConfig.forEach(({ service, configuration, typeConfig, bucketConfig }) => {
        const usageConfig = isUsageConfig(typeConfig) ? typeConfig : null;
        const unitRateCents = firstPositiveRateInCents(
          usageConfig?.base_rate,
          configuration?.custom_rate,
          usageModeDefaultsByServiceId.get(service.service_id),
          service.default_rate
        );

        usageServices.push({
          service_id: service.service_id,
          service_name: service.service_name,
          unit_rate: unitRateCents,
          unit_of_measure:
            usageConfig?.unit_of_measure ||
            service.unit_of_measure || resolveUnitOfMeasure({ fallback: 'C62' }).label,
          bucket_overlay:
            bucketConfig && isBucketConfig(bucketConfig)
              ? {
                  total_minutes: bucketConfig.total_minutes ?? undefined,
                  overage_rate:
                    bucketConfig.overage_rate != null ? Math.round(Number(bucketConfig.overage_rate)) : undefined,
                  allow_rollover: Boolean(bucketConfig.allow_rollover),
                  billing_period: bucketConfig.billing_period === 'weekly' ? 'weekly' : 'monthly',
                }
              : undefined,
        });
      });
    }
  }

  const startDate = normalizeDateOnly(clientContract.start_date);
  if (!startDate) {
    return actionError('Draft contract has an invalid start date', 'msp/contracts:errors.wizard.invalidStartDate');
  }

  const renewalMode =
    clientContract.renewal_mode === 'none' ||
    clientContract.renewal_mode === 'manual' ||
    clientContract.renewal_mode === 'auto'
      ? clientContract.renewal_mode
      : undefined;

  const noticePeriodRaw = clientContract.notice_period_days;
  const noticePeriodDays =
    noticePeriodRaw != null && Number.isFinite(Number(noticePeriodRaw))
      ? Math.max(0, Math.trunc(Number(noticePeriodRaw)))
      : undefined;

  const renewalTermRaw = clientContract.renewal_term_months;
  const renewalTermMonths =
    renewalTermRaw != null && Number.isFinite(Number(renewalTermRaw))
      ? Math.trunc(Number(renewalTermRaw)) > 0
        ? Math.trunc(Number(renewalTermRaw))
        : undefined
      : undefined;

  // Template-derived draft: re-express the saved lines as per-line edits keyed
  // by template line id. The clone preserves template line order, so lines are
  // paired by position; if the counts differ (template edited since, or a line
  // removed) we cannot pair safely and resume shows the template unedited.
  let templateLineEdits: ClientTemplateLineEditInput[] | undefined;
  if (clientContract.template_contract_id) {
    const templateLineRows = (await tenantDb(knex, tenant).table('contract_template_lines')
      .where({ template_id: clientContract.template_contract_id })
      .orderBy('display_order', 'asc')
      .orderBy('created_at', 'asc')
      .select('template_line_id')) as Array<{ template_line_id: string }>;

    if (templateLineRows.length > 0 && templateLineRows.length === detailedLines.length) {
      // Amount fields that exist only on the live rows: line overtime, hourly
      // member overtime and pool overage. Without them a resumed draft would
      // re-save with those amounts emptied.
      const lineIds = detailedLines.map((line) => line.contract_line_id);
      const liveLineRows = (await tenantDb(knex, tenant).table('contract_lines')
        .whereIn('contract_line_id', lineIds)
        .select('contract_line_id', 'overtime_rate')) as Array<{ contract_line_id: string; overtime_rate: unknown }>;
      const overtimeByLineId = new Map(liveLineRows.map((row) => [row.contract_line_id, row.overtime_rate]));

      const hourlyConfigIds = detailedLines.flatMap((line) =>
        (servicesByLineId.get(line.contract_line_id) ?? [])
          .map(({ configuration }) => configuration?.config_id)
          .filter((id): id is string => Boolean(id)),
      );
      const memberOvertimeRows = hourlyConfigIds.length
        ? ((await tenantDb(knex, tenant).table('contract_line_service_hourly_config')
            .whereIn('config_id', hourlyConfigIds)
            .select('config_id', 'overtime_rate')) as Array<{ config_id: string; overtime_rate: unknown }>)
        : [];
      const memberOvertimeByConfigId = new Map(memberOvertimeRows.map((row) => [row.config_id, row.overtime_rate]));

      const livePools = (await tenantDb(knex, tenant).table('contract_line_buckets')
        .whereIn('contract_line_id', lineIds)
        .select('contract_line_id', 'bucket_id', 'bucket_name', 'total_minutes', 'overage_rate')) as Array<{
        contract_line_id: string;
        bucket_id: string;
        bucket_name: string | null;
        total_minutes: number | string | null;
        overage_rate: unknown;
      }>;
      const templatePools = (await tenantDb(knex, tenant).table('contract_template_line_buckets')
        .whereIn('template_line_id', templateLineRows.map((row) => row.template_line_id))
        .select('template_line_id', 'bucket_id', 'bucket_name', 'total_minutes')) as Array<{
        template_line_id: string;
        bucket_id: string;
        bucket_name: string | null;
        total_minutes: number | string | null;
      }>;
      // Pool clones carry no stable link to their template pool, so pools are
      // paired within a line by (name, minutes) order, like lines are by position.
      const poolOrder = (a: { bucket_name: string | null; total_minutes: number | string | null }, b: typeof a) =>
        (a.bucket_name ?? '').localeCompare(b.bucket_name ?? '') ||
        Number(a.total_minutes ?? 0) - Number(b.total_minutes ?? 0);
      const centsOrNull = (value: unknown): number | null =>
        value != null && Number.isFinite(Number(value)) ? Math.round(Number(value)) : null;

      templateLineEdits = detailedLines.map((line, index) => {
        const members = servicesByLineId.get(line.contract_line_id) ?? [];
        const templateLineId = templateLineRows[index].template_line_id;
        const edit: ClientTemplateLineEditInput = {
          template_line_id: templateLineId,
          line_name: line.contract_line_name,
          billing_frequency: line.billing_frequency,
          overtime_rate: centsOrNull(overtimeByLineId.get(line.contract_line_id)),
        };

        const lineLivePools = livePools.filter((pool) => pool.contract_line_id === line.contract_line_id).sort(poolOrder);
        const lineTemplatePools = templatePools.filter((pool) => pool.template_line_id === templateLineId).sort(poolOrder);
        if (lineTemplatePools.length > 0 && lineLivePools.length === lineTemplatePools.length) {
          edit.bucket_overage_rates = lineTemplatePools.map((pool, poolIndex) => ({
            bucket_id: pool.bucket_id,
            rate: centsOrNull(lineLivePools[poolIndex].overage_rate),
          }));
        }
        if (line.contract_line_type === 'Fixed') {
          edit.fixed_base_rate = line.rate != null ? Math.round(Number(line.rate)) : null;
        }
        edit.services = members.map(({ service, configuration, typeConfig }) => {
          let rate: number | null = null;
          if (line.contract_line_type === 'Hourly' && isHourlyConfig(typeConfig)) {
            rate = typeConfig.hourly_rate != null ? Math.round(Number(typeConfig.hourly_rate)) : null;
            edit.minimum_billable_time = typeConfig.minimum_billable_time ?? null;
            edit.round_up_to_nearest = typeConfig.round_up_to_nearest ?? null;
          } else if (line.contract_line_type === 'Usage' && isUsageConfig(typeConfig)) {
            rate = typeConfig.base_rate != null ? Math.round(Number(typeConfig.base_rate)) : null;
          } else if (line.contract_line_type === 'Fixed') {
            // Per-seat member: the unit rate (fixed config base_rate). Bundle member:
            // its allocated share, which the clone also mirrors into base_rate.
            const fixedBase = typeConfig && 'pricing_basis' in typeConfig
              ? (typeConfig as IContractLineServiceFixedConfig).base_rate
              : null;
            const stored = configuration?.custom_rate ?? fixedBase;
            rate = stored != null ? Math.round(Number(stored)) : null;
          } else if (configuration?.custom_rate != null) {
            rate = Math.round(Number(configuration.custom_rate));
          }
          return {
            service_id: service.service_id,
            quantity: configuration?.quantity != null ? Number(configuration.quantity) : null,
            rate,
            ...(line.contract_line_type === 'Hourly' && configuration?.config_id
              ? { overtime_rate: centsOrNull(memberOvertimeByConfigId.get(configuration.config_id)) }
              : {}),
            // Legacy per-service overage (templates without pools): the clone
            // stores it on a line pool whose id is the member's config id.
            ...(lineTemplatePools.length === 0 && configuration?.config_id
              && lineLivePools.some((pool) => pool.bucket_id === configuration.config_id)
              ? {
                  bucket_overage_rate: centsOrNull(
                    lineLivePools.find((pool) => pool.bucket_id === configuration.config_id)?.overage_rate,
                  ),
                }
              : {}),
          };
        });
        return edit;
      });
    }
  }

  const resumed: DraftContractWizardData = {
    client_id: clientContract.client_id,
    billing_profile_id: clientContract.billing_profile_id ?? null,
    contract_name: contract.contract_name,
    start_date: startDate,
    end_date: normalizeDateOnly(clientContract.end_date) ?? undefined,
    renewal_mode: renewalMode,
    notice_period_days: noticePeriodDays,
    renewal_term_months: renewalTermMonths,
    use_tenant_renewal_defaults:
      typeof clientContract.use_tenant_renewal_defaults === 'boolean'
        ? clientContract.use_tenant_renewal_defaults
        : undefined,
    cadence_owner: cadenceOwner,
    billing_timing: billingTiming,
    description: contract.contract_description ?? undefined,
    billing_frequency: contract.billing_frequency ?? 'monthly',
    currency_code: contract.currency_code ?? 'USD',
    po_number: clientContract.po_number ?? undefined,
    po_amount: clientContract.po_amount != null ? Number(clientContract.po_amount) : undefined,
    po_required: Boolean(clientContract.po_required),
    fixed_lines: fixedLines,
    // Explicit only when it differs from the contract default, so an inheriting products line stays inheriting.
    product_billing_timing:
      storedProductsTiming && storedProductsTiming !== billingTiming ? storedProductsTiming : undefined,
    product_services: productServices,
    enable_proration: enableProration,
    recurring_baseline: {
      monthly_cents:
        (await getContractMonthlyFixedValuesByContract(knex, tenant, [contractId])).get(contractId)
          ?.monthlyValueCents ?? 0,
    },
    hourly_services: hourlyServices,
    hourly_billing_frequency: hourlyBillingFrequency,
    minimum_billable_time: minimumBillableTime,
    round_up_to_nearest: roundUpToNearest,
    prepaid_block_lines: prepaidBlockLines,
    usage_services: usageServices,
    usage_billing_frequency: usageBillingFrequency,
    contract_id: contractId,
    is_draft: true,
    template_id: clientContract.template_contract_id ?? undefined,
    template_lines: templateLineEdits,
  };

  // Fidelity: the wizard must be able to hold everything that affects revenue. If re-projecting the
  // resumed data differs from what is stored, refuse rather than let Finish Setup rewrite it.
  // A template-derived draft is re-saved by re-cloning the template with the per-line edits above
  // (per-line cadence, billable-time rounding and rates included), not from the flat wizard lines,
  // so the flat projection does not describe what it will write; the save-time monthly-value guard
  // still covers it.
  const differences = resumed.template_id
    ? []
    : diffRecurringShapes(
        recurringShapeFromStoredLines(storedLines, { contractBillingFrequency: resumed.billing_frequency }),
        recurringShapeFromWizard(resumed),
      );
  if (differences.length > 0) {
    const summary = differences.map((d) => d.message).join('; ');
    return actionError(
      `This draft can't be resumed in the wizard without changing its pricing: ${summary}`,
      'msp/contracts:errors.wizard.resumeUnsupportedShape',
      { lines: summary },
    );
  }

  return resumed;
});
