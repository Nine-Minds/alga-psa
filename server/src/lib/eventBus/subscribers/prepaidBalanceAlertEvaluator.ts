/**
 * Prepaid balance alert evaluator (task 29.8.20).
 *
 * Runs the daily 09:00 UTC scan for one tenant: for every client with a
 * configured prepaid policy it evaluates canonical credit and bucket ledgers
 * and opens/resolves/dedupes rows in `prepaid_balance_alerts`.
 *
 * Correctness relies on the database, not scheduling: each client's evaluation
 * runs in a short transaction that locks its `client_billing_settings` row, and
 * the tenant-unique `(tenant, dedupe_key)` constraint is the final backstop for
 * replayed or concurrent scans.
 */

import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { tenantDb } from '@alga-psa/db';
import { getAvailableCredit } from '@alga-psa/billing/lib/creditBalance';
import { getAvailableHourBlockMinutesForSubjects } from '@alga-psa/shared/billingClients/hourBlockService';
import {
  bucketCapacity,
  bucketDedupeKey,
  bucketPolicyChanged,
  bucketThresholdReached,
  bucketUsedPercent,
  creditDedupeKey,
  creditPolicyChanged,
  hasValidBucketCapacity,
  isCreditLow,
  RESOLUTION_REASON_POLICY_CHANGED,
  RESOLUTION_REASON_RECOVERED,
  type BucketObservationInput,
  type CreditPolicySnapshot,
} from '@alga-psa/billing/lib/prepaidBalanceAlerts';

export interface EvaluatorWarning {
  code: 'no_credit_history' | 'non_positive_capacity' | 'client_not_found' | 'evaluation_error';
  clientId?: string;
  clientName?: string;
  bucketUsageId?: string;
  currencyCode?: string;
  message: string;
}

export interface EvaluatorSummary {
  configuredClients: number;
  creditSubjects: number;
  bucketSubjects: number;
  creditAlertsOpened: number;
  creditAlertsResolved: number;
  creditAlertsDeduplicated: number;
  bucketAlertsOpened: number;
  bucketAlertsResolved: number;
  bucketAlertsDeduplicated: number;
  invalidSubjects: number;
  warnings: EvaluatorWarning[];
}

interface ConfiguredClient {
  client_id: string;
  client_name: string;
  prepaid_credit_alert_threshold: number | string | null;
  prepaid_credit_alert_currency_code: string | null;
  bucket_usage_alert_percent: number | string | null;
}

interface CandidateClient {
  client_id: string;
  client_name: string;
}

interface OpenAlert {
  alert_id: string;
  client_id: string;
  alert_type: string;
  credit_threshold: number | string | null;
  credit_currency_code: string | null;
  bucket_percent: number | string | null;
  bucket_usage_id: string | null;
}

interface CurrentBucketSubject extends BucketObservationInput {
  usage_id: string;
  period_start: string | Date;
  period_end: string | Date;
  service_catalog_id: string;
  contract_line_id: string;
  client_contract_id: string;
}

function emptySummary(): EvaluatorSummary {
  return {
    configuredClients: 0,
    creditSubjects: 0,
    bucketSubjects: 0,
    creditAlertsOpened: 0,
    creditAlertsResolved: 0,
    creditAlertsDeduplicated: 0,
    bucketAlertsOpened: 0,
    bucketAlertsResolved: 0,
    bucketAlertsDeduplicated: 0,
    invalidSubjects: 0,
    warnings: [],
  };
}

async function loadConfiguredClients(
  trx: Knex.Transaction | Knex,
  tenantId: string,
  clientId?: string
): Promise<ConfiguredClient[]> {
  const db = tenantDb(trx, tenantId);
  const query = db.table('client_billing_settings as cbs')
    .select(
      'cbs.client_id',
      'cl.client_name',
      'cbs.prepaid_credit_alert_threshold',
      'cbs.prepaid_credit_alert_currency_code',
      'cbs.bucket_usage_alert_percent',
      'cbs.notify_client_on_prepaid_alert'
    );
  db.tenantJoin(query, 'clients as cl', 'cbs.client_id', 'cl.client_id');
  query
    .where('cbs.tenant', tenantId)
    .andWhere((qb) => {
      qb.whereNotNull('cbs.prepaid_credit_alert_threshold')
        .orWhereNotNull('cbs.bucket_usage_alert_percent');
    });
  if (clientId) {
    query.andWhere('cbs.client_id', clientId);
  }
  const rows = await query;
  return rows as ConfiguredClient[];
}

async function loadOpenAlertClients(
  conn: Knex,
  tenantId: string,
  clientId?: string
): Promise<CandidateClient[]> {
  const db = tenantDb(conn, tenantId);
  const query = db.table('prepaid_balance_alerts as a')
    .distinct('a.client_id', 'cl.client_name');
  db.tenantJoin(query, 'clients as cl', 'a.client_id', 'cl.client_id');
  query.whereNull('a.resolved_at');
  if (clientId) {
    query.andWhere('a.client_id', clientId);
  }
  return (await query) as CandidateClient[];
}

async function findOpenAlert(
  db: ReturnType<typeof tenantDb>,
  clientId: string,
  alertType: 'credit' | 'bucket',
  bucketUsageId?: string
): Promise<OpenAlert | null> {
  const query = db.table('prepaid_balance_alerts')
    .where({ client_id: clientId, alert_type: alertType, resolved_at: null })
    .orderBy('created_at', 'desc')
    .first();
  if (bucketUsageId !== undefined) {
    query.where({ bucket_usage_id: bucketUsageId });
  }
  return (await query) as OpenAlert | null;
}

async function nextCreditEpisode(
  db: ReturnType<typeof tenantDb>,
  tenantId: string,
  clientId: string
): Promise<number> {
  const row = await db.table('prepaid_balance_alerts')
    .where({ tenant: tenantId, client_id: clientId, alert_type: 'credit' })
    .max({ maxEpisode: 'episode' })
    .first();
  return Number(row?.maxEpisode ?? 0) + 1;
}

async function resolveAlert(db: ReturnType<typeof tenantDb>, alert: OpenAlert, reason: string): Promise<void> {
  await db.table('prepaid_balance_alerts')
    .where({ alert_id: alert.alert_id })
    .update({ resolved_at: new Date().toISOString(), resolution_reason: reason });
}

async function findBucketAlertByIdentity(
  db: ReturnType<typeof tenantDb>,
  bucketUsageId: string,
  percent: number
): Promise<(OpenAlert & { resolved_at: string | Date | null }) | null> {
  return (await db.table('prepaid_balance_alerts')
    .where({ dedupe_key: bucketDedupeKey(bucketUsageId, percent) })
    .first()) as (OpenAlert & { resolved_at: string | Date | null }) | null;
}

async function resolveStaleBuckets(
  db: ReturnType<typeof tenantDb>,
  clientId: string,
  currentUsageIds: Set<string>
): Promise<number> {
  const stale = await db.table('prepaid_balance_alerts')
    .where({ client_id: clientId, alert_type: 'bucket', resolved_at: null })
    .whereNotIn('bucket_usage_id', [...currentUsageIds])
    .select('alert_id', 'bucket_usage_id');
  for (const alert of stale) {
    await resolveAlert(db, alert, RESOLUTION_REASON_RECOVERED);
  }
  return stale.length;
}

async function resolveCurrentBucketSubjects(
  trx: Knex.Transaction,
  tenantId: string,
  clientId: string,
  todayISO: string
): Promise<CurrentBucketSubject[]> {
  const db = tenantDb(trx, tenantId);
  const query = db.table('client_contracts as cc')
    .select(
      'bu.usage_id',
      'bu.minutes_used',
      'bu.rolled_over_minutes',
      'psbc.total_minutes',
      'bu.period_start',
      'bu.period_end',
      'bu.service_catalog_id',
      'bu.contract_line_id',
      'cc.client_contract_id'
    );
  db.tenantJoin(query, 'contracts as ct', 'ct.contract_id', 'cc.contract_id');
  db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_id', 'ct.contract_id');
  db.tenantJoin(query, 'contract_line_service_configuration as psc', 'psc.contract_line_id', 'cl.contract_line_id', {
    on(join) {
      join.andOnVal('psc.configuration_type', '=', 'Bucket');
    },
  });
  db.tenantJoin(query, 'contract_line_service_bucket_config as psbc', 'psc.config_id', 'psbc.config_id');
  // Contract lines can be shared across clients (system-managed default
  // contracts), so the usage row must be pinned to the evaluated client —
  // matching billingEngine / getRemainingBucketUnits. Without it client A
  // would alert on client B's bucket usage.
  db.tenantJoin(query, 'bucket_usage as bu', 'bu.contract_line_id', 'cl.contract_line_id', {
    rootTenantColumn: 'cc.tenant',
    on(join) {
      join.andOn('bu.service_catalog_id', '=', 'psc.service_id');
      join.andOn('bu.client_id', '=', 'cc.client_id');
    },
  });
  query
    .where('cc.client_id', clientId)
    .andWhere('cc.is_active', true)
    .andWhere('bu.period_start', '<=', todayISO)
    .andWhere('bu.period_end', '>=', todayISO);

  const rows = (await query) as Array<{
    usage_id: string;
    minutes_used: number | string;
    rolled_over_minutes: number | string;
    total_minutes: number | string;
    period_start: string | Date;
    period_end: string | Date;
    service_catalog_id: string;
    contract_line_id: string;
    client_contract_id: string;
  }>;

  const observations = rows.map((row) => ({
    usage_id: row.usage_id,
    minutesUsed: Number(row.minutes_used) || 0,
    rolledOverMinutes: Number(row.rolled_over_minutes) || 0,
    totalMinutes: Number(row.total_minutes) || 0,
    configuredPercent: 0, // filled by caller
    period_start: row.period_start,
    period_end: row.period_end,
    service_catalog_id: row.service_catalog_id,
    contract_line_id: row.contract_line_id,
    client_contract_id: row.client_contract_id,
  }));
  const blockMinutes = await getAvailableHourBlockMinutesForSubjects(
    trx,
    tenantId,
    clientId,
    observations.map((subject) => ({ key: subject.usage_id, serviceId: subject.service_catalog_id })),
  );
  return observations.map((subject) => ({
    ...subject,
    additionalMinutes: blockMinutes.get(subject.usage_id) ?? 0,
  }));
}

async function evaluateClientCredit(
  trx: Knex.Transaction,
  tenantId: string,
  client: ConfiguredClient,
  summary: EvaluatorSummary
): Promise<void> {
  const threshold = Number(client.prepaid_credit_alert_threshold);
  const currencyCode = client.prepaid_credit_alert_currency_code;
  if (threshold <= 0 || !currencyCode) {
    return;
  }
  summary.creditSubjects += 1;
  const db = tenantDb(trx, tenantId);

  const historyRow = await db.table('credit_tracking')
    .where({ client_id: client.client_id, currency_code: currencyCode })
    .first('credit_id');
  const hasHistory = Boolean(historyRow);

  if (!hasHistory) {
    summary.invalidSubjects += 1;
    summary.warnings.push({
      code: 'no_credit_history',
      clientId: client.client_id,
      clientName: client.client_name,
      currencyCode,
      message: `No credit history for client ${client.client_id} / ${currencyCode}; skipped zero-balance evaluation`,
    });
  }

  const available = await getAvailableCredit(trx, tenantId, client.client_id, currencyCode);
  const low = isCreditLow({ available, hasHistory, threshold });
  const currentPolicy: CreditPolicySnapshot = { threshold, currencyCode };

  const open = await findOpenAlert(db, client.client_id, 'credit');

  if (open) {
    const openPolicy: CreditPolicySnapshot = {
      threshold: Number(open.credit_threshold),
      currencyCode: open.credit_currency_code ?? '',
    };
    if (creditPolicyChanged(openPolicy, currentPolicy)) {
      await resolveAlert(db, open, RESOLUTION_REASON_POLICY_CHANGED);
      summary.creditAlertsResolved += 1;
    } else if (!low) {
      await resolveAlert(db, open, RESOLUTION_REASON_RECOVERED);
      summary.creditAlertsResolved += 1;
    }
  }

  if (!low) {
    return;
  }

  const openAfterResolution = await findOpenAlert(db, client.client_id, 'credit');
  if (openAfterResolution) {
    // Same policy and still below threshold: refresh observations, no new alert.
    await db.table('prepaid_balance_alerts')
      .where({ alert_id: openAfterResolution.alert_id })
      .update({
        observed_value: available,
        payload: JSON.stringify({ available, threshold, currencyCode }),
      });
    summary.creditAlertsDeduplicated += 1;
    return;
  }

  const episode = await nextCreditEpisode(db, tenantId, client.client_id);
  await db.table('prepaid_balance_alerts')
    .insert({
      tenant: tenantId,
      alert_id: randomUUID(),
      client_id: client.client_id,
      alert_type: 'credit',
      dedupe_key: creditDedupeKey(client.client_id, currencyCode, episode),
      episode,
      credit_threshold: threshold,
      credit_currency_code: currencyCode,
      observed_value: available,
      payload: JSON.stringify({ available, threshold, currencyCode }),
    });
  summary.creditAlertsOpened += 1;
}

async function evaluateClientBuckets(
  trx: Knex.Transaction,
  tenantId: string,
  client: ConfiguredClient,
  summary: EvaluatorSummary,
  todayISO: string
): Promise<void> {
  const percent = Number(client.bucket_usage_alert_percent);
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
    return;
  }
  const db = tenantDb(trx, tenantId);
  const subjects = await resolveCurrentBucketSubjects(trx, tenantId, client.client_id, todayISO);

  for (const subject of subjects) {
    try {
      summary.bucketSubjects += 1;
      const capacity = bucketCapacity(subject);
      if (!hasValidBucketCapacity(subject)) {
        summary.invalidSubjects += 1;
        summary.warnings.push({
          code: 'non_positive_capacity',
          clientId: client.client_id,
          clientName: client.client_name,
          bucketUsageId: subject.usage_id,
          message: `Bucket usage ${subject.usage_id} has non-positive capacity (${capacity}); skipped`,
        });
        continue;
      }

      const reached = bucketThresholdReached({ ...subject, configuredPercent: percent });
      const open = await findOpenAlert(db, client.client_id, 'bucket', subject.usage_id);

      if (open) {
        // A changed configured percentage is a new subject and resolves the
        // old episode as policy_changed. Recovery within the SAME period does
        // NOT resolve the episode: one alert is opened per (bucket_usage,
        // period, configured percentage), so consumption oscillating around
        // the threshold must never re-alert. The episode resolves only on
        // period rollover (below) or a disabled policy (tenant-wide sweep).
        if (bucketPolicyChanged(Number(open.bucket_percent), percent)) {
          await resolveAlert(db, open, RESOLUTION_REASON_POLICY_CHANGED);
          summary.bucketAlertsResolved += 1;
        }
      }

      if (!reached) {
        // A settled replenishment block is an entitlement-backed recovery,
        // unlike ordinary usage oscillation within the same period. Resolve
        // that episode so clearing its invoice lock cannot cause the next
        // replenishment sweep to invoice the same top-up again.
        if (open && (subject.additionalMinutes ?? 0) > 0 && !bucketPolicyChanged(Number(open.bucket_percent), percent)) {
          await resolveAlert(db, open, RESOLUTION_REASON_RECOVERED);
          summary.bucketAlertsResolved += 1;
        }
        continue;
      }

      const usedPercent = bucketUsedPercent({ ...subject, configuredPercent: percent });
      const existingIdentity = await findBucketAlertByIdentity(db, subject.usage_id, percent);
      if (existingIdentity) {
        // Reuse the same logical alert when a policy returns to a percentage
        // already seen in this usage period. This preserves the approved
        // (usage period, configured percentage) identity and prevents a
        // disable/re-enable or 80 -> 90 -> 80 sequence from creating a second
        // 80-percent alert.
        await db.table('prepaid_balance_alerts')
          .where({ alert_id: existingIdentity.alert_id })
          .update({
            observed_value: subject.minutesUsed,
            observed_capacity: capacity,
            resolved_at: null,
            resolution_reason: null,
            payload: JSON.stringify({
              minutesUsed: subject.minutesUsed,
              capacity,
              usedPercent,
              percent,
              periodStart: subject.period_start,
              periodEnd: subject.period_end,
            }),
          });
        summary.bucketAlertsDeduplicated += 1;
        continue;
      }

      await db.table('prepaid_balance_alerts')
        .insert({
          tenant: tenantId,
          alert_id: randomUUID(),
          client_id: client.client_id,
          alert_type: 'bucket',
          dedupe_key: bucketDedupeKey(subject.usage_id, percent),
          episode: 1,
          bucket_percent: percent,
          observed_value: subject.minutesUsed,
          observed_capacity: capacity,
          bucket_usage_id: subject.usage_id,
          service_catalog_id: subject.service_catalog_id,
          contract_line_id: subject.contract_line_id,
          period_start: subject.period_start,
          period_end: subject.period_end,
          payload: JSON.stringify({
            minutesUsed: subject.minutesUsed,
            capacity,
            usedPercent,
            percent,
            periodStart: subject.period_start,
            periodEnd: subject.period_end,
          }),
        });
      summary.bucketAlertsOpened += 1;
    } catch (error) {
      // One bucket subject's failure never aborts the client's other buckets
      // or (via the separate transaction) its credit evaluation.
      summary.warnings.push({
        code: 'evaluation_error',
        clientId: client.client_id,
        clientName: client.client_name,
        bucketUsageId: subject.usage_id,
        message: `Bucket subject ${subject.usage_id} evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  // A period rollover (or removed bucket) leaves the old subject open; resolve
  // those episodes so only current subjects can carry an open alert.
  const currentUsageIds = new Set(subjects.map((s) => s.usage_id));
  summary.bucketAlertsResolved += await resolveStaleBuckets(db, client.client_id, currentUsageIds);
}

export async function evaluatePrepaidBalanceAlertsForTenant(
  knex: Knex,
  tenantId: string,
  clientId?: string
): Promise<EvaluatorSummary> {
  const summary = emptySummary();
  const [configured, openAlertClients] = await Promise.all([
    loadConfiguredClients(knex, tenantId, clientId),
    loadOpenAlertClients(knex, tenantId, clientId),
  ]);
  summary.configuredClients = configured.length;

  // Disabled policies are absent from loadConfiguredClients, so candidate
  // evaluation must also include every client that still has an open alert.
  // The locked settings row below is the source of truth; the values loaded
  // here are used only to discover candidate client IDs.
  const candidates = new Map<string, CandidateClient>();
  for (const client of [...configured, ...openAlertClients]) {
    candidates.set(client.client_id, {
      client_id: client.client_id,
      client_name: client.client_name,
    });
  }

  const todayISO = new Date().toISOString().slice(0, 10);

  const creditConfiguredFor = (c: ConfiguredClient) =>
    c.prepaid_credit_alert_threshold != null && c.prepaid_credit_alert_currency_code != null;
  const bucketConfiguredFor = (c: ConfiguredClient) => c.bucket_usage_alert_percent != null;

  const lockSettingsRow = async (
    trx: Knex.Transaction,
    client: CandidateClient
  ): Promise<ConfiguredClient> => {
    const db = tenantDb(trx, tenantId);
    const lockRow = await db.table('client_billing_settings')
      .where({ client_id: client.client_id })
      .forUpdate()
      .first();
    if (!lockRow) {
      summary.warnings.push({
        code: 'client_not_found',
        clientId: client.client_id,
        clientName: client.client_name,
        message: `Client billing settings row missing for ${client.client_id}`,
      });
      return {
        ...client,
        prepaid_credit_alert_threshold: null,
        prepaid_credit_alert_currency_code: null,
        bucket_usage_alert_percent: null,
      };
    }
    return {
      ...client,
      prepaid_credit_alert_threshold: lockRow.prepaid_credit_alert_threshold,
      prepaid_credit_alert_currency_code: lockRow.prepaid_credit_alert_currency_code,
      bucket_usage_alert_percent: lockRow.bucket_usage_alert_percent,
    };
  };

  const resolveDisabledType = async (
    trx: Knex.Transaction,
    candidateClientId: string,
    alertType: 'credit' | 'bucket'
  ): Promise<number> => {
    const db = tenantDb(trx, tenantId);
    const open = await db.table('prepaid_balance_alerts')
      .where({ client_id: candidateClientId, alert_type: alertType, resolved_at: null })
      .select('alert_id');
    for (const alert of open) {
      await resolveAlert(db, alert, RESOLUTION_REASON_POLICY_CHANGED);
    }
    return open.length;
  };

  for (const candidate of candidates.values()) {
    // Credit and bucket evaluation run in SEPARATE transactions so a failure
    // in one subject type can never roll back the other's already-committed
    // writes. Each transaction re-reads the policy under the settings-row lock,
    // preventing a disabled policy from creating an alert from stale scan data.
    try {
      await knex.transaction(async (trx) => {
        const client = await lockSettingsRow(trx, candidate);
        if (creditConfiguredFor(client)) {
          await evaluateClientCredit(trx, tenantId, client, summary);
        } else {
          summary.creditAlertsResolved += await resolveDisabledType(trx, client.client_id, 'credit');
        }
      });
    } catch (error) {
      summary.warnings.push({
        code: 'evaluation_error',
        clientId: candidate.client_id,
        clientName: candidate.client_name,
        message: `Credit evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    try {
      await knex.transaction(async (trx) => {
        const client = await lockSettingsRow(trx, candidate);
        if (bucketConfiguredFor(client)) {
          await evaluateClientBuckets(trx, tenantId, client, summary, todayISO);
        } else {
          summary.bucketAlertsResolved += await resolveDisabledType(trx, client.client_id, 'bucket');
        }
      });
    } catch (error) {
      summary.warnings.push({
        code: 'evaluation_error',
        clientId: candidate.client_id,
        clientName: candidate.client_name,
        message: `Bucket evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return summary;
}
