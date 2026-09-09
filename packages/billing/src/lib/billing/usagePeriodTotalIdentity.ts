import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IBillingCharge, IExpectedUsagePeriodTotal, IUsageServicePeriodStatus, ISO8601String } from '@alga-psa/types';

export type { IExpectedUsagePeriodTotal };

/**
 * Derives the full previewed identity of every period-total-backed usage
 * charge so preview responses can hand generation exactly what the operator
 * approved. Charges without a period total (additive usage, other charge
 * types) carry no expectation — their consistency is owned by the
 * already-invoiced guards.
 */
export function buildExpectedUsagePeriodTotalsFromCharges(
  charges: IBillingCharge[],
): IExpectedUsagePeriodTotal[] {
  const expected: IExpectedUsagePeriodTotal[] = [];
  for (const charge of charges) {
    if (charge.type !== 'usage') {
      continue;
    }
    const periodTotalCharge = charge as {
      usagePeriodTotalId?: string | null;
      usagePeriodTotalRevision?: number | null;
      client_contract_line_id?: string;
      serviceId?: string;
      config_id?: string | null;
      servicePeriodStart?: string | null;
      servicePeriodEnd?: string | null;
      quantity?: number;
      total?: number;
    };
    if (!periodTotalCharge.usagePeriodTotalId) {
      continue;
    }
    expected.push({
      clientContractLineId: periodTotalCharge.client_contract_line_id ?? '',
      serviceId: periodTotalCharge.serviceId ?? '',
      periodStart: (periodTotalCharge.servicePeriodStart ?? '') as ISO8601String,
      periodEnd: (periodTotalCharge.servicePeriodEnd ?? '') as ISO8601String,
      revision: Number(periodTotalCharge.usagePeriodTotalRevision ?? 1),
      periodTotalId: periodTotalCharge.usagePeriodTotalId,
      ...(periodTotalCharge.config_id ? { configId: periodTotalCharge.config_id } : {}),
      quantity: Number(periodTotalCharge.quantity ?? 0),
      totalCents: Number(periodTotalCharge.total ?? 0),
    });
  }
  return expected;
}

/** Fingerprint persisted billing inputs as well as the resulting amount. */
export async function bindUsagePeriodTotalInputs(
  knex: Knex, tenant: string, clientId: string, charges: IBillingCharge[], statuses: IUsageServicePeriodStatus[] = [],
): Promise<IExpectedUsagePeriodTotal[]> {
  const db = tenantDb(knex, tenant);
  const identities = buildExpectedUsagePeriodTotalsFromCharges(charges);
  for (const status of statuses) {
    if (status.measurement_mode !== 'period_total' || !status.config_id) continue;
    if (identities.some(identity => identity.clientContractLineId === status.client_contract_line_id && identity.serviceId === status.service_id && identity.periodStart === status.service_period_start && identity.periodEnd === status.service_period_end)) continue;
    identities.push({clientContractLineId: status.client_contract_line_id, serviceId: status.service_id, configId: status.config_id,
      periodStart: status.service_period_start, periodEnd: status.service_period_end, revision: Number(status.revision ?? 0), quantity: Number(status.billable_quantity ?? 0), totalCents: 0});
  }
  for (const identity of identities) {
    const query = db.table('usage_period_totals');
    const report = await (identity.periodTotalId ? query.where('period_total_id', identity.periodTotalId) : query.where({
      client_id: clientId, client_contract_line_id: identity.clientContractLineId, service_id: identity.serviceId,
      config_id: identity.configId, period_start: identity.periodStart, period_end: identity.periodEnd,
    })).first();
    identity.periodTotalId = report?.period_total_id;
    identity.revision = Number(report?.revision ?? 0);
    identity.configId = report?.config_id ?? identity.configId;
    const configId = identity.configId;
    const line = await db.table('contract_lines').where('contract_line_id', identity.clientContractLineId).first();
    const inputs = [report, line];
    for (const table of ['contract_line_service_configuration', 'contract_line_service_usage_config', 'contract_line_service_rate_tiers', 'usage_measurement_revisions']) {
      inputs.push(configId ? await db.table(table).where('config_id', configId).select('*') : []);
    }
    inputs.push(await db.table('service_catalog').where('service_id', identity.serviceId).first());
    inputs.push(await db.table('service_prices').where('service_id', identity.serviceId).select('*'));
    inputs.push(line?.contract_id ? await db.table('contracts').where('contract_id', line.contract_id).first() : null);
    inputs.push(line?.contract_id ? await db.table('client_contracts').where({client_id: clientId, contract_id: line.contract_id}).select('*') : []);
    const canonical = (value: any): any => value instanceof Date ? value.toISOString()
      : Array.isArray(value) ? value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    identity.billingInputsHash = createHash('sha256').update(JSON.stringify(canonical(inputs))).digest('hex');
  }
  return identities;
}
