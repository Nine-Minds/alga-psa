import { lockTenantBilling } from './billingMutationLock';
import { resolveNextUnbilledSeatBoundary, validateProspectivePricingBoundary } from './seatRevisions';
import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { UsageMeasurementMode, IContractLineServiceConfiguration, IContractLineServiceUsageConfig, IContractLineServiceRateTier } from '@alga-psa/types';

/**
 * Transactional core of usage measurement-mode transitions.
 *
 * Changing a service configuration between additive consumption and
 * period-total reporting is a semantic transition, not a relabel: entries and
 * one replaceable period count cannot coexist for the same service/period.
 * The transition is prospective by construction — it is refused while ANY
 * unbilled evidence recorded under the old mode exists, so billed history
 * stays untouched and every unbilled period starts clean under the new mode.
 *
 * Orphan checks are complete, not key-exact:
 *  - switching TO period_total is refused while unbilled additive entries
 *    could be attributed to the (line, service) — including entries recorded
 *    WITHOUT a contract-line id for a client assigned to the line's contract,
 *    which the engine would otherwise attribute to this line at billing time;
 *  - switching TO additive is refused while any unbilled (recorded) period
 *    total exists for the (line, service) — regardless of which config row
 *    it was reported against (a recreated configuration must not strand a
 *    sibling config's report).
 *
 * Callers own the surrounding transaction, so a transition and any pricing
 * writes that ride with it commit or roll back together — no partial writes.
 */

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  tenant: string,
  table: string,
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

interface UsagePricingSnapshot {
  baseConfig?: Pick<Partial<IContractLineServiceConfiguration>, 'custom_rate'>;
  typeConfig?: Pick<Partial<IContractLineServiceUsageConfig>, 'unit_of_measure' | 'minimum_usage' | 'enable_tiered_pricing' | 'base_rate'>;
  rateTiers?: IContractLineServiceRateTier[];
}

/** Omitted fields inherit; explicit null, zero, false and empty tiers are edits. */
function definedFields<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as Partial<T>;
}

export interface ISetUsageMeasurementModeInput {
  config_id: string;
  contract_line_id: string;
  service_id: string;
  measurement_mode?: UsageMeasurementMode;
  effective_period_start?: string;
  pricing?: UsagePricingSnapshot;
}

export type SetUsageMeasurementModeResult =
  | { ok: true; measurement_mode: UsageMeasurementMode; effective_period_start?: string }
  | { ok: false; error: string };

export async function setUsageMeasurementModeInTransaction(params: {
  trx: Knex.Transaction;
  tenant: string;
  input: ISetUsageMeasurementModeInput;
}): Promise<SetUsageMeasurementModeResult> {
  const { trx, tenant, input } = params;
  await lockTenantBilling(trx, tenant);

  if (input.measurement_mode !== undefined && input.measurement_mode !== 'additive' && input.measurement_mode !== 'period_total') {
    return { ok: false, error: 'Measurement mode must be additive or period_total.' };
  }

  const config = await tenantScopedTable(trx, tenant, 'contract_line_service_configuration')
    .where({
      tenant,
      config_id: input.config_id,
      contract_line_id: input.contract_line_id,
      service_id: input.service_id,
      configuration_type: 'Usage',
    })
    .first<IContractLineServiceConfiguration>();
  if (!config) {
    return {
      ok: false,
      error: 'The selected service configuration is not a Usage configuration on that contract line.',
    };
  }

  const usageConfig = await tenantScopedTable(trx, tenant, 'contract_line_service_usage_config')
    .where({ tenant, config_id: input.config_id })
    .first<IContractLineServiceUsageConfig>();
  const boundary = input.effective_period_start ?? await resolveNextUnbilledSeatBoundary({trx, tenant, contractLineId: input.contract_line_id});
  const current = boundary ? await resolveUsageMeasurementRevision(trx, tenant, input.config_id, boundary) : null;
  const currentMode: UsageMeasurementMode = current?.measurement_mode ?? usageConfig?.measurement_mode ?? 'additive';
  const targetMode = input.measurement_mode ?? currentMode;
  if (boundary) {
    const conflict = await validateProspectivePricingBoundary(trx, tenant, input.contract_line_id, boundary);
    if (conflict) return {ok: false, error: conflict};
  }
  // Store a complete snapshot, including mode-only and first same-mode edits.
  // The caller supplies only changed fields; inheritance comes from the price
  // effective at this boundary, never from a stale authoring baseline.
  const previousPricing: UsagePricingSnapshot = current?.pricing ?? {};
  const pricing: UsagePricingSnapshot = {
    baseConfig: {
      custom_rate: config.custom_rate,
      ...previousPricing.baseConfig,
      ...definedFields(input.pricing?.baseConfig ?? {}),
    },
    typeConfig: {
      unit_of_measure: usageConfig?.unit_of_measure,
      minimum_usage: usageConfig?.minimum_usage,
      enable_tiered_pricing: usageConfig?.enable_tiered_pricing,
      base_rate: usageConfig?.base_rate,
      ...previousPricing.typeConfig,
      ...definedFields(input.pricing?.typeConfig ?? {}),
    },
    rateTiers: input.pricing?.rateTiers ?? previousPricing.rateTiers ??
      await tenantScopedTable(trx, tenant, 'contract_line_service_rate_tiers').where('config_id', input.config_id).orderBy('min_quantity').select('*'),
  };

  if (currentMode !== targetMode && targetMode === 'period_total') {
    // Explicitly attributed unbilled entries on this line.
    const orphanedEntries = await tenantScopedTable(trx, tenant, 'usage_tracking')
      .where({ tenant, service_id: input.service_id, contract_line_id: input.contract_line_id })
      .modify(q => { if (boundary) q.where('usage_date', '>=', boundary); })
      .first('usage_id');
    if (orphanedEntries) {
      return {
        ok: false,
        error:
          'This service still has unbilled additive entries on the contract line. Bill or remove them before switching to period-total reporting, or use a new configuration.',
      };
    }
    // Unattributed unbilled entries (no contract-line id) for clients assigned
    // to this line's contract: billing would attribute them to this line, so
    // the transition would strand them just the same.
    const line = await tenantScopedTable(trx, tenant, 'contract_lines')
      .where({ tenant, contract_line_id: input.contract_line_id })
      .first<{ contract_id: string | null }>('contract_id');
    if (line?.contract_id) {
      const unattributedEntry = await tenantScopedTable(trx, tenant, 'usage_tracking as ut')
        .where({ 'ut.tenant': tenant, 'ut.service_id': input.service_id })
        .whereNull('ut.contract_line_id')
        .whereIn(
          'ut.client_id',
          tenantScopedTable(trx, tenant, 'client_contracts')
            .where({ tenant, contract_id: line.contract_id })
            .select('client_id'),
        )
        .modify(q => { if (boundary) q.where('ut.usage_date', '>=', boundary); })
        .first('ut.usage_id');
      if (unattributedEntry) {
        return {
          ok: false,
          error:
            'A client assigned to this contract still has unbilled usage entries for this service that are not attributed to a contract line. Bill or attribute them before switching to period-total reporting.',
        };
      }
    }
  }

  if (currentMode !== targetMode && targetMode === 'additive') {
    // Any unbilled recorded total for the (line, service) — regardless of
    // which configuration row reported it — would be stranded.
    const recordedTotal = await tenantScopedTable(trx, tenant, 'usage_period_totals')
      .where({
        tenant,
        client_contract_line_id: input.contract_line_id,
        service_id: input.service_id,
      })
      .modify(q => { if (boundary) q.where('period_end', '>=', boundary); })
      .first('period_total_id');
    if (recordedTotal) {
      return {
        ok: false,
        error:
          'This service has a recorded period total that is not yet invoiced. Bill it before switching back to additive consumption.',
      };
    }
  }

  if (boundary) {
    await tenantScopedTable(trx, tenant, 'usage_measurement_revisions').insert({
      tenant, config_id: input.config_id, effective_period_start: boundary,
      measurement_mode: targetMode, pricing,
    }).onConflict(['tenant', 'config_id', 'effective_period_start']).merge(['measurement_mode', 'pricing']);
  } else {
    await tenantScopedTable(trx, tenant, 'contract_line_service_usage_config')
      .where({ tenant, config_id: input.config_id }).update({ measurement_mode: targetMode });
  }
  return { ok: true, measurement_mode: targetMode, ...(boundary ? {effective_period_start: boundary} : {}) };
}

export async function resolveUsageMeasurementRevision(knex: Knex, tenant: string, configId: string, periodStart: string) {
  const revisions = () => tenantScopedTable(knex, tenant, 'usage_measurement_revisions')
    .where({ config_id: configId }).where('effective_period_start', '<=', periodStart.slice(0, 10))
    .orderBy('effective_period_start', 'desc');
  const revision = await revisions().first();
  if (revision && revision.pricing == null) {
    // Older mode-only rows did not snapshot prices. Their mode still applies,
    // while pricing continues from the latest explicit snapshot at/before it.
    const pricedRevision = await revisions().whereNotNull('pricing').first();
    return { ...revision, pricing: pricedRevision?.pricing ?? null };
  }
  return revision;
}
