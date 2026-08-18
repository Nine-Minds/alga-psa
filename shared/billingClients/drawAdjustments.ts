/**
 * Per-side weighted draw adjustments for time entries and usage records.
 *
 * LEVERAGE: pattern per-side-draw — time entries (create/update/delete) and
 * usage records (create/update/delete) all do "reverse the old draw under the
 * old context, apply the new draw under the new context"; this module is the
 * single owner of that shape so every caller resolves each side under its own
 * (tenant, client, line, pool, multiplier, schedule).
 *
 * An edit or reassignment must reverse the OLD draw under the OLD record's own
 * context and apply the NEW draw under the NEW record's own context — tenant,
 * client, contract-line membership, pool, multiplier, and schedule. Each
 * caller derives the client from the record's OWN work item; these helpers
 * resolve the pool from that client plus the record's preferred contract line,
 * then adjust `bucket_usage` by the exact weighted delta for that side.
 *
 * The old side is never resolved under the new context (and vice versa): the
 * caller passes the old record's client + span for the reversal and the new
 * record's client + span for the application.
 */
import type { Knex } from 'knex';
import { computeWeightedMinutes } from './weightedBurn';
import {
  findOrCreateCurrentBucketUsageRecord,
  loadAfterHoursRuleForBucket,
  resolveBucketDraw,
  updateBucketUsageMinutes,
} from './bucketUsageService';

/** A time-entry side: the record's own span, service, line, and duration. */
export interface TimeSpanDrawSource {
  service_id?: string | null;
  start_time: string | Date;
  end_time: string | Date;
  billable_duration?: number | null;
  contract_line_id?: string | null;
}

/** A usage-tracking side: the record's own quantity, date, service, and line. */
export interface QuantityDrawSource {
  service_id?: string | null;
  quantity: number;
  usage_date: string | Date;
  contract_line_id?: string | null;
}

function startInstant(startTime: string | Date): Date {
  return new Date(String(startTime));
}

/**
 * Adjust the weighted bucket draw of ONE time-entry side under that side's own
 * (tenant, client, line) context. `direction` is +1 to apply a draw, -1 to
 * reverse one. Returns the signed weighted delta actually applied (0 when the
 * side resolves to no bucket or has no billable duration).
 */
export async function adjustTimeSpanDraw(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  source: TimeSpanDrawSource,
  direction: 1 | -1,
): Promise<number> {
  const billableDuration = Number(source.billable_duration ?? 0);
  if (billableDuration <= 0 || !source.service_id) {
    return 0;
  }

  const draw = await resolveBucketDraw(
    trx,
    clientId,
    source.service_id,
    startInstant(source.start_time).toISOString(),
    source.contract_line_id ?? null,
    tenant,
  );
  if (!draw) {
    return 0;
  }

  const afterHoursRule = await loadAfterHoursRuleForBucket(trx, tenant, draw.bucketId);
  const { weightedMinutes } = computeWeightedMinutes(
    {
      startTime: startInstant(source.start_time),
      endTime: new Date(String(source.end_time)),
      billableDuration,
    },
    draw.memberMultiplier,
    afterHoursRule,
  );
  if (weightedMinutes === 0) {
    return 0;
  }

  const delta = direction * weightedMinutes;
  const usageRecord = await findOrCreateCurrentBucketUsageRecord(
    trx,
    clientId,
    source.service_id,
    startInstant(source.start_time).toISOString(),
    source.contract_line_id ?? null,
    tenant,
  );
  await updateBucketUsageMinutes(trx, usageRecord.usage_id, delta, tenant);
  return delta;
}

/**
 * Adjust the weighted bucket draw of ONE usage-tracking side under that side's
 * own (tenant, client, line) context. Usage draws have no time span: they burn
 * at the member multiplier only (no after-hours proration). `direction` is +1
 * to apply, -1 to reverse. Returns the signed weighted delta actually applied.
 */
export async function adjustQuantityDraw(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  source: QuantityDrawSource,
  direction: 1 | -1,
): Promise<number> {
  const quantity = Number(source.quantity ?? 0);
  if (quantity === 0 || !source.service_id) {
    return 0;
  }

  const draw = await resolveBucketDraw(
    trx,
    clientId,
    source.service_id,
    String(source.usage_date),
    source.contract_line_id ?? null,
    tenant,
  );
  if (!draw) {
    return 0;
  }

  const weighted = quantity * draw.memberMultiplier;
  if (weighted === 0) {
    return 0;
  }

  const delta = direction * weighted;
  const usageRecord = await findOrCreateCurrentBucketUsageRecord(
    trx,
    clientId,
    source.service_id,
    String(source.usage_date),
    source.contract_line_id ?? null,
    tenant,
  );
  await updateBucketUsageMinutes(trx, usageRecord.usage_id, delta, tenant);
  return delta;
}
