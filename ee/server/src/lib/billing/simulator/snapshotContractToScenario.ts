/**
 * Loads a live contract's full billing configuration into an in-memory
 * ContractScenario the simulator workspace can mutate freely. Strictly
 * read-only: only SELECTs, no writes of any kind.
 */

import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { Temporal } from '@js-temporal/polyfill';
import type {
  ContractScenario,
  BillingCycleType,
  ISO8601String,
  ScenarioClientBinding,
  ScenarioAssumption,
  ScenarioLine,
  ScenarioLineService,
  ScenarioPricingSchedule,
  ScenarioBillingSchedule,
  ScenarioServiceConfig,
} from '@alga-psa/types';
import { toISODate, toPlainDate } from '@alga-psa/core';
import { tenantDb } from '@alga-psa/db';
import { resolveCadenceOwner } from '@alga-psa/shared/billingClients/recurringTiming';
import { getClientBillingCycleAnchor } from '@alga-psa/shared/billingClients/billingSchedule';
import { normalizeAnchorSettingsForCycle } from '@alga-psa/shared/billingClients/billingCycleAnchors';
import {
  ClientContractServiceConfigurationService,
  type ClientContractServiceConfigDetails,
} from '@alga-psa/billing/services/clientContractServiceConfigurationService';
import { assumptionKey } from './syntheticActivity';

const DEFAULT_HORIZON_PERIOD_COUNT = 6;

export interface SnapshotContractToScenarioParams {
  contractId: string;
  clientContractId: string | null;
}

interface ContractRow {
  contract_id: string;
  contract_name: string;
  owner_client_id: string | null;
  billing_frequency: string;
  currency_code: string | null;
  is_system_managed_default: boolean | null;
}

interface ContractLineRow {
  contract_line_id: string;
  contract_line_name: string;
  contract_line_type: string;
  billing_frequency: string | null;
  billing_timing: 'arrears' | 'advance' | null;
  cadence_owner: string | null;
  custom_rate: number | string | null;
  enable_proration: boolean | null;
  location_id: string | null;
  enable_overtime: boolean | null;
  overtime_threshold: number | string | null;
  overtime_rate: number | string | null;
}

interface CatalogRateRow {
  service_id: string;
  service_name: string;
  default_rate: number | string | null;
  tax_rate_id: string | null;
  currency_rate: number | string | null;
  item_kind: string | null;
  is_license: boolean | null;
}

function toCents(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function toMidnightIso(value: unknown): ISO8601String {
  return `${toISODate(toPlainDate(value as string | Date))}T00:00:00Z`;
}

export async function snapshotContractToScenario(
  knex: Knex,
  tenant: string,
  params: SnapshotContractToScenarioParams,
): Promise<ContractScenario> {
  if (!tenant) {
    throw new Error('Tenant context is required to snapshot a contract scenario');
  }
  if (!params?.contractId) {
    throw new Error('contractId is required to snapshot a contract scenario');
  }

  const db = tenantDb(knex, tenant);

  const contract = (await db
    .table('contracts')
    .where({ contract_id: params.contractId })
    .first(
      'contract_id',
      'contract_name',
      'owner_client_id',
      'billing_frequency',
      'currency_code',
      'is_system_managed_default',
    )) as ContractRow | undefined;

  if (!contract) {
    throw new Error(
      `Contract ${params.contractId} not found in tenant ${tenant}`,
    );
  }

  const currencyCode = contract.currency_code || 'USD';

  const lineRows = (await db
    .table('contract_lines')
    .where({ contract_id: params.contractId })
    .orderBy('display_order', 'asc')
    .orderBy('contract_line_name', 'asc')
    .select(
      'contract_line_id',
      'contract_line_name',
      'contract_line_type',
      'billing_frequency',
      'billing_timing',
      'cadence_owner',
      'custom_rate',
      'enable_proration',
      'location_id',
      'enable_overtime',
      'overtime_threshold',
      'overtime_rate',
    )) as ContractLineRow[];

  const configService = new ClientContractServiceConfigurationService(
    knex,
    tenant,
  );
  const configsByLine = new Map<string, ClientContractServiceConfigDetails[]>();
  for (const lineRow of lineRows) {
    configsByLine.set(
      lineRow.contract_line_id,
      await configService.getConfigurationsForClientContractLine(
        lineRow.contract_line_id,
      ),
    );
  }

  // Catalog names/rates for every referenced service, with the contract
  // currency's service_prices row preferred over the currency-untagged legacy
  // service_catalog.default_rate — the same resolution production time-based
  // and usage rate lookups use.
  const serviceIds = Array.from(
    new Set(
      Array.from(configsByLine.values()).flatMap((configs) =>
        configs.map((config) => config.serviceId),
      ),
    ),
  );
  const catalogByServiceId = new Map<string, CatalogRateRow>();
  if (serviceIds.length > 0) {
    const catalogQuery = db.table('service_catalog as sc');
    db.tenantJoin(catalogQuery, 'service_prices as sp', 'sp.service_id', 'sc.service_id', {
      type: 'left',
      on(join) {
        join.andOn('sp.currency_code', '=', knex.raw('?', [currencyCode]));
      },
    });
    const catalogRows = (await catalogQuery
      .whereIn('sc.service_id', serviceIds)
      .select(
        'sc.service_id',
        'sc.service_name',
        'sc.default_rate',
        'sc.tax_rate_id',
        'sp.rate as currency_rate',
        'sc.item_kind',
        'sc.is_license',
      )) as CatalogRateRow[];
    for (const row of catalogRows) {
      catalogByServiceId.set(row.service_id, row);
    }
  }

  const lines: ScenarioLine[] = lineRows.map((lineRow) =>
    buildScenarioLine(
      lineRow,
      contract,
      configsByLine.get(lineRow.contract_line_id) ?? [],
      catalogByServiceId,
    ),
  );

  const pricingSchedules = await loadPricingSchedules(db, params.contractId);

  const { clientBinding, contractStartDate, contractEndDate, invoiceSchedule } =
    await resolveClientBinding(knex, db, tenant, params, contract, currencyCode);

  const assumptions: Record<string, ScenarioAssumption> = {};
  for (const line of lines) {
    for (const service of line.services) {
      const configType = service.configuration.configuration_type;
      if (configType === 'Hourly' || configType === 'Usage' || configType === 'Bucket') {
        assumptions[assumptionKey(line.key, service.service_id)] = { flat: 0 };
      }
    }
  }

  const today = Temporal.Now.plainDateISO('UTC');

  return {
    scenario_id: uuidv4(),
    name: `${contract.contract_name} scenario`,
    contract_id: contract.contract_id,
    is_system_managed_default: Boolean(contract.is_system_managed_default),
    client_binding: clientBinding,
    invoice_schedule: invoiceSchedule,
    billing_frequency: contract.billing_frequency,
    contract_start_date: contractStartDate,
    contract_end_date: contractEndDate,
    currency_code: currencyCode,
    lines,
    pricing_schedules: pricingSchedules,
    assumptions,
    horizon: {
      start_date: `${toISODate(today)}T00:00:00Z`,
      period_count: DEFAULT_HORIZON_PERIOD_COUNT,
    },
  };
}

function buildScenarioLine(
  lineRow: ContractLineRow,
  contract: ContractRow,
  configs: ClientContractServiceConfigDetails[],
  catalogByServiceId: Map<string, CatalogRateRow>,
): ScenarioLine {
  const contractLineType = lineRow.contract_line_type;
  if (
    contractLineType !== 'Fixed' &&
    contractLineType !== 'Hourly' &&
    contractLineType !== 'Usage'
  ) {
    throw new Error(
      `Contract line ${lineRow.contract_line_id} ("${lineRow.contract_line_name}") ` +
        `has unsupported contract_line_type "${contractLineType}"; expected Fixed, Hourly, or Usage`,
    );
  }

  const services: ScenarioLineService[] = configs.map((configDetails) => {
    const catalog = catalogByServiceId.get(configDetails.serviceId);
    if (!catalog) {
      throw new Error(
        `Service ${configDetails.serviceId} referenced by contract line ` +
          `${lineRow.contract_line_id} ("${lineRow.contract_line_name}") is missing from service_catalog`,
      );
    }

    return {
      service_id: configDetails.serviceId,
      service_name: catalog.service_name,
      quantity: Number(configDetails.baseConfig.quantity ?? 1) || 1,
      custom_rate: toCents(configDetails.baseConfig.custom_rate ?? null),
      default_rate:
        toCents(catalog.currency_rate) ?? toCents(catalog.default_rate),
      tax_rate_id: catalog.tax_rate_id ?? null,
      item_kind: catalog.item_kind ?? null,
      is_license: Boolean(catalog.is_license),
      configuration: buildScenarioServiceConfig(configDetails),
    };
  });

  return {
    key: lineRow.contract_line_id,
    origin_contract_line_id: lineRow.contract_line_id,
    contract_line_name: lineRow.contract_line_name,
    contract_line_type: contractLineType,
    billing_frequency: lineRow.billing_frequency || contract.billing_frequency,
    billing_timing: lineRow.billing_timing ?? 'arrears',
    cadence_owner: resolveCadenceOwner(
      (lineRow.cadence_owner as 'client' | 'contract' | null) ?? null,
    ),
    custom_rate: toCents(lineRow.custom_rate),
    enable_proration: Boolean(lineRow.enable_proration),
    location_id: lineRow.location_id ?? null,
    enable_overtime: Boolean(lineRow.enable_overtime),
    overtime_threshold:
      lineRow.overtime_threshold != null ? Number(lineRow.overtime_threshold) : null,
    overtime_rate: toCents(lineRow.overtime_rate),
    services,
  };
}

function buildScenarioServiceConfig(
  configDetails: ClientContractServiceConfigDetails,
): ScenarioServiceConfig {
  const configurationType = configDetails.baseConfig.configuration_type;

  switch (configurationType) {
    case 'Fixed': {
      const fixed = configDetails.typeConfig as { base_rate?: number | null } | null;
      return {
        configuration_type: 'Fixed',
        base_rate: toCents(fixed?.base_rate ?? null),
      };
    }
    case 'Hourly': {
      const hourly = configDetails.typeConfig as {
        hourly_rate?: number | null;
        minimum_billable_time?: number | null;
        round_up_to_nearest?: number | null;
      } | null;
      return {
        configuration_type: 'Hourly',
        hourly_rate: toCents(hourly?.hourly_rate ?? null),
        minimum_billable_time: Number(hourly?.minimum_billable_time ?? 0) || 0,
        round_up_to_nearest: Number(hourly?.round_up_to_nearest ?? 0) || 0,
        user_type_rates: (configDetails.userTypeRates ?? []).map((rate) => ({
          user_type: rate.user_type,
          rate: Number(rate.rate),
        })),
      };
    }
    case 'Usage': {
      const usage = configDetails.typeConfig as {
        unit_of_measure?: string;
        enable_tiered_pricing?: boolean;
        minimum_usage?: number | string | null;
        base_rate?: number | null;
      } | null;
      return {
        configuration_type: 'Usage',
        unit_of_measure: usage?.unit_of_measure ?? 'unit',
        enable_tiered_pricing: Boolean(usage?.enable_tiered_pricing),
        minimum_usage:
          usage?.minimum_usage != null ? Number(usage.minimum_usage) : null,
        base_rate: toCents(usage?.base_rate ?? null),
        tiers: (configDetails.rateTiers ?? []).map((tier) => ({
          min_quantity: Number(tier.min_quantity),
          max_quantity: tier.max_quantity != null ? Number(tier.max_quantity) : null,
          rate: Number(tier.rate),
        })),
      };
    }
    case 'Bucket': {
      const bucket = configDetails.typeConfig as {
        total_minutes?: number;
        billing_period?: string;
        overage_rate?: number;
        allow_rollover?: boolean;
      } | null;
      if (!bucket) {
        throw new Error(
          `Bucket configuration ${configDetails.baseConfig.config_id} for service ` +
            `${configDetails.serviceId} has no contract_line_service_bucket_config row`,
        );
      }
      return {
        configuration_type: 'Bucket',
        total_minutes: Number(bucket.total_minutes ?? 0),
        billing_period: bucket.billing_period ?? 'monthly',
        overage_rate: toCents(bucket.overage_rate ?? 0) ?? 0,
        allow_rollover: Boolean(bucket.allow_rollover),
      };
    }
    default:
      throw new Error(
        `Service ${configDetails.serviceId} has unsupported configuration_type ` +
          `"${configurationType}" (config ${configDetails.baseConfig.config_id})`,
      );
  }
}

async function loadPricingSchedules(
  db: ReturnType<typeof tenantDb>,
  contractId: string,
): Promise<ScenarioPricingSchedule[]> {
  const rows = await db
    .table('contract_pricing_schedules')
    .where({ contract_id: contractId })
    .orderBy('effective_date', 'asc')
    .select('effective_date', 'end_date', 'custom_rate');

  return rows.map((row: { effective_date: unknown; end_date: unknown; custom_rate: number | string | null }) => ({
    effective_date: toMidnightIso(row.effective_date),
    end_date: row.end_date ? toMidnightIso(row.end_date) : null,
    custom_rate: toCents(row.custom_rate),
  }));
}

async function resolveClientBinding(
  knex: Knex,
  db: ReturnType<typeof tenantDb>,
  tenant: string,
  params: SnapshotContractToScenarioParams,
  contract: ContractRow,
  currencyCode: string,
): Promise<{
  clientBinding: ScenarioClientBinding;
  contractStartDate: ISO8601String | null;
  contractEndDate: ISO8601String | null;
  invoiceSchedule: ScenarioBillingSchedule;
}> {
  if (params.clientContractId) {
    const clientContract = await db
      .table('client_contracts')
      .where({ client_contract_id: params.clientContractId })
      .first('client_contract_id', 'client_id', 'contract_id', 'start_date', 'end_date');
    if (!clientContract) {
      throw new Error(
        `Client contract ${params.clientContractId} not found in tenant ${tenant}`,
      );
    }
    if (clientContract.contract_id !== params.contractId) {
      throw new Error(
        `Client contract ${params.clientContractId} belongs to contract ` +
          `${clientContract.contract_id}, not ${params.contractId}`,
      );
    }

    const client = await db
      .table('clients')
      .where({ client_id: clientContract.client_id })
      .first('client_id', 'client_name');
    if (!client) {
      throw new Error(
        `Client ${clientContract.client_id} referenced by client contract ` +
          `${params.clientContractId} not found in tenant ${tenant}`,
      );
    }

    return {
      clientBinding: {
        kind: 'client',
        client_id: client.client_id,
        client_name: client.client_name,
      },
      contractStartDate: clientContract.start_date
        ? toMidnightIso(clientContract.start_date)
        : null,
      contractEndDate: clientContract.end_date
        ? toMidnightIso(clientContract.end_date)
        : null,
      invoiceSchedule: await loadClientInvoiceSchedule(
        knex,
        tenant,
        client.client_id,
      ),
    };
  }

  if (contract.owner_client_id) {
    const client = await db
      .table('clients')
      .where({ client_id: contract.owner_client_id })
      .first('client_id', 'client_name');
    if (!client) {
      throw new Error(
        `Owner client ${contract.owner_client_id} of contract ` +
          `${contract.contract_id} not found in tenant ${tenant}`,
      );
    }

    return {
      clientBinding: {
        kind: 'client',
        client_id: client.client_id,
        client_name: client.client_name,
      },
      contractStartDate: null,
      contractEndDate: null,
      invoiceSchedule: await loadClientInvoiceSchedule(
        knex,
        tenant,
        client.client_id,
      ),
    };
  }

  // Template-style contract with no client attached: simulate against a
  // hypothetical client profile in the contract currency.
  return {
    clientBinding: {
      kind: 'profile',
      tax_region: null,
      currency_code: currencyCode,
    },
    contractStartDate: null,
    contractEndDate: null,
    invoiceSchedule: buildDefaultInvoiceSchedule(contract.billing_frequency),
  };
}

async function loadClientInvoiceSchedule(
  knex: Knex,
  tenant: string,
  clientId: string,
): Promise<ScenarioBillingSchedule> {
  const schedule = await getClientBillingCycleAnchor(
    knex,
    tenant,
    clientId,
  );
  return {
    billing_cycle: schedule.billingCycle,
    anchor: {
      day_of_month: schedule.anchor.dayOfMonth,
      month_of_year: schedule.anchor.monthOfYear,
      day_of_week: schedule.anchor.dayOfWeek,
      reference_date: schedule.anchor.referenceDate,
    },
  };
}

function buildDefaultInvoiceSchedule(frequency: string): ScenarioBillingSchedule {
  const billingCycle = normalizeScenarioBillingCycle(frequency);
  const anchor = normalizeAnchorSettingsForCycle(billingCycle, {});
  return {
    billing_cycle: billingCycle,
    anchor: {
      day_of_month: anchor.dayOfMonth,
      month_of_year: anchor.monthOfYear,
      day_of_week: anchor.dayOfWeek,
      reference_date: anchor.referenceDate,
    },
  };
}

function normalizeScenarioBillingCycle(frequency: string): BillingCycleType {
  switch (frequency.trim().toLowerCase()) {
    case 'weekly':
      return 'weekly';
    case 'bi-weekly':
    case 'biweekly':
      return 'bi-weekly';
    case 'quarterly':
      return 'quarterly';
    case 'semi-annually':
    case 'semi-annual':
    case 'semiannually':
      return 'semi-annually';
    case 'annually':
    case 'annual':
    case 'yearly':
      return 'annually';
    default:
      return 'monthly';
  }
}
