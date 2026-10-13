import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { tenantDb } from '@alga-psa/db';
import { createPrepaidReplenishmentInvoice } from '@alga-psa/billing/lib/prepaidAutoReplenishment';
import { finalizeInvoiceWithKnex } from '@alga-psa/billing/actions/invoiceModification';
import { enqueueImmediateJob } from '@alga-psa/core';
import { supersedeExpiryIssuancesForLine } from '@alga-psa/billing/services/prepaidBlockLifecycleService';

type AlertRow = {
  alert_id: string;
  client_id: string;
  alert_type: 'credit' | 'bucket' | 'prepaid_block';
  resolved_at: string | null;
  replenishment_status: string | null;
  replenishment_invoice_id: string | null;
  replenishment_credit_amount: number | string | null;
  replenishment_bucket_minutes: number | string | null;
  credit_currency_code: string | null;
  service_catalog_id: string | null;
  contract_line_id: string | null;
  bucket_usage_id: string | null;
  hour_block_id: string | null;
  bucket_percent: number | string | null;
  replenishment_attempt_count?: number | null;
};

type ReplenishmentResult = 'created' | 'skipped' | 'unchanged' | 'failed';

type ContractHorizonRow = {
  end_date: string | Date | null;
  renewal_mode: string | null;
  decision_due_date: string | Date | null;
};

type ContractPolicyRow = ContractHorizonRow & {
  client_contract_id: string;
  contract_id: string;
  prepaid_replenishment_tier: string | null;
  prepaid_credit_replenishment_amount: number | string | null;
  prepaid_bucket_replenishment_minutes: number | string | null;
  prepaid_replenishment_horizon_days: number | string | null;
};

export interface PrepaidAutoReplenishmentSummary {
  considered: number;
  created: number;
  autoIssued: number;
  skipped: number;
  unchanged: number;
  failed: number;
}

const TERMINAL_REPLENISHMENT_STATES = new Set(['pending', 'issued', 'failed', 'skipped']);

function isoDateDaysFromNow(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function getAlertContract(
  trx: Knex.Transaction,
  tenant: string,
  alert: AlertRow,
): Promise<ContractPolicyRow | null> {
  if (alert.alert_type === 'credit' || !alert.contract_line_id) return null;
  const today = new Date().toISOString().slice(0, 10);
  const db = tenantDb(trx, tenant);
  const query = db.table('client_contracts as cc')
    .select(
      'cc.client_contract_id', 'cc.contract_id', 'cc.end_date', 'cc.renewal_mode', 'cc.decision_due_date',
      'cc.prepaid_replenishment_tier', 'cc.prepaid_credit_replenishment_amount',
      'cc.prepaid_bucket_replenishment_minutes', 'cc.prepaid_replenishment_horizon_days',
    )
    .where({ 'cc.client_id': alert.client_id, 'cc.is_active': true })
    .where((builder) => builder.whereNull('cc.start_date').orWhere('cc.start_date', '<=', today))
    .where((builder) => builder.whereNull('cc.end_date').orWhere('cc.end_date', '>=', today));
  db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_id', 'cc.contract_id');
  query.where('cl.contract_line_id', alert.contract_line_id);
  db.tenantJoin(query, 'contracts as c', 'c.contract_id', 'cc.contract_id');
  query.where({ 'c.is_active': true, 'c.status': 'active' });
  const rows = await query as ContractPolicyRow[];
  return rows[0] ?? null;
}

function contractTerminatingWithinHorizon(contract: ContractPolicyRow, horizonDays: number): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const horizon = isoDateDaysFromNow(horizonDays);
  const decisionDate = contract.renewal_mode === 'none'
    ? contract.end_date
    : contract.decision_due_date ?? contract.end_date;
  if (!decisionDate) return false;
  const date = new Date(decisionDate).toISOString().slice(0, 10);
  return date >= today && date <= horizon;
}

async function clientTerminatingWithinHorizon(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  horizonDays: number,
): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  const db = tenantDb(trx, tenant);
  const query = db.table('client_contracts as cc')
    .select('cc.end_date', 'cc.renewal_mode', 'cc.decision_due_date')
    .where({ 'cc.client_id': clientId, 'cc.is_active': true })
    .where((builder) => builder.whereNull('cc.start_date').orWhere('cc.start_date', '<=', today))
    .where((builder) => builder.whereNull('cc.end_date').orWhere('cc.end_date', '>=', today));
  db.tenantJoin(query, 'contracts as c', 'c.contract_id', 'cc.contract_id');
  query.where({ 'c.is_active': true, 'c.status': 'active' });
  const contracts = await query as ContractPolicyRow[];

  // Credit is a client-wide balance and cannot be assigned to one contract.
  // Treat the client as churning only when every active contract is inside the
  // horizon; one continuing contract is enough to keep the client policy live.
  return contracts.length > 0 && contracts.every((contract) =>
    contractTerminatingWithinHorizon(contract, horizonDays),
  );
}

async function processAlert(
  knex: Knex,
  tenant: string,
  alertId: string,
): Promise<{ result: ReplenishmentResult; autoIssue: boolean }> {
  let autoIssue = false;
  let invoiceId: string | null = null;
  let alertType: AlertRow['alert_type'] | null = null;

  const result = await knex.transaction(async (trx) => {
    const db = tenantDb(trx, tenant);
    const alert = await db.table('prepaid_balance_alerts')
      .where({ alert_id: alertId, resolved_at: null })
      .forUpdate()
      .first() as AlertRow | undefined;
    if (!alert) return 'unchanged' as const;
    alertType = alert.alert_type;

    const settings = await db.table('client_billing_settings')
      .where({ client_id: alert.client_id })
      .first(
        'prepaid_replenishment_tier',
        'prepaid_credit_replenishment_amount',
        'prepaid_bucket_replenishment_minutes',
        'prepaid_replenishment_horizon_days',
      );
    // Config/issuance locks come before any block lock (plan Risk 6). Taken
    // here, right under the alert lock, so everything below (open follow-on
    // check, issuance insert, block creation) runs under the line's lock.
    const blockConfig = alert.alert_type === 'prepaid_block' && alert.contract_line_id
      ? await db.table('contract_line_prepaid_blocks')
        .where({ contract_line_id: alert.contract_line_id })
        .forUpdate()
        .first('contract_line_id', 'block_minutes', 'replenishment_tier')
      : null;

    const contract = await getAlertContract(trx, tenant, alert);
    if (alert.alert_type !== 'credit' && !contract) {
      await db.table('prepaid_balance_alerts').where({ alert_id: alert.alert_id }).update({
        replenishment_status: 'skipped',
        replenishment_attempted_at: trx.fn.now(),
        replenishment_error: alert.alert_type === 'prepaid_block'
          ? 'Prepaid block alert is not linked to an active client contract'
          : 'Bucket alert is not linked to an active client contract',
        updated_at: trx.fn.now(),
      });
      return 'skipped' as const;
    }
    if (alert.alert_type === 'prepaid_block' && !blockConfig) {
      await db.table('prepaid_balance_alerts').where({ alert_id: alert.alert_id }).update({
        replenishment_status: 'skipped',
        replenishment_attempted_at: trx.fn.now(),
        replenishment_error: 'Prepaid block configuration no longer exists for this line',
        updated_at: trx.fn.now(),
      });
      return 'skipped' as const;
    }
    // A Prepaid Block line carries its own tier (draft | auto_issue); the
    // contract/client override chain does not apply, and the block size/price
    // come from the line config rather than a replenishment amount.
    const tier = alert.alert_type === 'prepaid_block'
      ? (blockConfig!.replenishment_tier ?? 'draft')
      : (contract?.prepaid_replenishment_tier ?? settings?.prepaid_replenishment_tier ?? 'draft');
    const amount = Number(alert.alert_type === 'credit'
      ? (contract?.prepaid_credit_replenishment_amount ?? settings?.prepaid_credit_replenishment_amount)
      : alert.alert_type === 'prepaid_block'
        ? blockConfig!.block_minutes
        : (contract?.prepaid_bucket_replenishment_minutes ?? settings?.prepaid_bucket_replenishment_minutes));
    if (tier === 'notify' || !Number.isSafeInteger(amount) || amount <= 0) {
      return 'unchanged' as const;
    }

    if (alert.replenishment_invoice_id && TERMINAL_REPLENISHMENT_STATES.has(alert.replenishment_status ?? '')) {
      return 'unchanged' as const;
    }

    const horizonDays = Number(contract?.prepaid_replenishment_horizon_days ?? settings?.prepaid_replenishment_horizon_days ?? 30);
    const terminating = contract
      ? contractTerminatingWithinHorizon(contract, horizonDays)
      : alert.alert_type === 'credit'
        ? await clientTerminatingWithinHorizon(trx, tenant, alert.client_id, horizonDays)
        : false;
    if (terminating) {
      await db.table('prepaid_balance_alerts')
        .where({ alert_id: alert.alert_id })
        .update({
          replenishment_status: 'skipped',
          replenishment_attempted_at: trx.fn.now(),
          replenishment_error: 'Active client contract is terminating within the replenishment horizon',
          updated_at: trx.fn.now(),
        });
      return 'skipped' as const;
    }

    const client = await db.table('clients')
      .where({ client_id: alert.client_id })
      .first();
    if (!client) return 'unchanged' as const;

    let issuanceId: string | null = null;
    if (alert.alert_type === 'prepaid_block') {
      const lineId = alert.contract_line_id!;
      // At most one open follow-on per line: a pending contract block means a
      // follow-on is already drafted/awaiting finalize; a scheduled issuance
      // (other than a not-yet-needed expiry one) is an existing obligation.
      const pendingBlock = await db.table('hour_blocks')
        .where({ contract_line_id: lineId, status: 'pending' })
        .first('block_id');
      if (pendingBlock) return 'unchanged' as const;
      const openIssuance = await db.table('contract_line_block_issuances')
        .where({ contract_line_id: lineId, status: 'scheduled' })
        .forUpdate()
        .first('issuance_id', 'trigger_kind');
      if (openIssuance && openIssuance.trigger_kind !== 'expiry') return 'unchanged' as const;
      if (openIssuance) {
        // The usage trigger replaces the old block's expiry re-issue.
        await supersedeExpiryIssuancesForLine(trx, tenant, lineId, {
          reason: 'A usage-triggered block replaces the expiry issuance',
        });
      }
      issuanceId = randomUUID();
      await db.table('contract_line_block_issuances').insert({
        tenant,
        issuance_id: issuanceId,
        contract_line_id: lineId,
        client_contract_id: contract!.client_contract_id,
        client_id: alert.client_id,
        trigger_kind: alert.bucket_percent == null ? 'exhaustion' : 'threshold',
        due_date: new Date().toISOString().slice(0, 10),
        status: 'scheduled',
        source_block_id: alert.hour_block_id,
        alert_id: alert.alert_id,
      });
    }

    let serviceName: string | null = null;
    let hourlyRate: number | null = null;
    if (alert.alert_type === 'bucket') {
      const service = await db.table('service_catalog')
        .where({ service_id: alert.service_catalog_id })
        .first('service_name', 'default_rate');
      if (!service || !Number.isFinite(Number(service.default_rate))) {
        await db.table('prepaid_balance_alerts')
          .where({ alert_id: alert.alert_id })
          .update({
            replenishment_status: 'skipped',
            replenishment_attempted_at: trx.fn.now(),
            replenishment_error: 'Bucket replenishment service has no usable default rate',
            updated_at: trx.fn.now(),
          });
        return 'skipped' as const;
      }
      serviceName = service.service_name;
      hourlyRate = Number(service.default_rate);
    }

    const created = await createPrepaidReplenishmentInvoice(trx, {
      tenant,
      clientId: alert.client_id,
      subject: alert.alert_type,
      amount,
      // A Prepaid Block follow-on is priced from the line config in the CONTRACT
      // currency (resolved inside createPrepaidReplenishmentInvoice); the
      // client-default/USD fallback must never apply to it.
      currencyCode: alert.alert_type === 'prepaid_block'
        ? ''
        : alert.credit_currency_code ?? client.default_currency_code ?? 'USD',
      serviceId: alert.service_catalog_id,
      serviceName,
      hourlyRate,
      bucketUsageId: alert.bucket_usage_id,
      issuanceId,
    });
    invoiceId = created.invoiceId;
    autoIssue = tier === 'auto_issue';
    await db.table('prepaid_balance_alerts')
      .where({ alert_id: alert.alert_id })
      .update({
        replenishment_status: 'pending',
        replenishment_invoice_id: created.invoiceId,
        ...(alert.alert_type === 'credit'
          ? { replenishment_credit_amount: amount, replenishment_bucket_minutes: null }
          : { replenishment_credit_amount: null, replenishment_bucket_minutes: amount }),
        replenishment_attempted_at: trx.fn.now(),
        replenishment_attempt_count: 0,
        replenishment_error: null,
        updated_at: trx.fn.now(),
      });
    return 'created' as const;
  });

  if (result === 'created' && autoIssue && invoiceId) {
    try {
      // System finalization uses the same invoice lifecycle but does not draw
      // down existing credit against the replenishment invoice itself.
      await finalizeInvoiceWithKnex(invoiceId, knex, tenant, null, {
        skipAutoApply: true,
        // Credit/bucket top-ups activate at payment; a Prepaid Block follow-on
        // activates at finalize (invoiceModification exempts its alert type).
        deferPrepaidActivation: alertType !== 'prepaid_block',
        markReplenishmentIssued: false,
      });
      await enqueueImmediateJob('invoice_email', {
        invoiceIds: [invoiceId],
        tenantId: tenant,
        user_id: 'system',
        steps: [
          { stepName: `PDF Generation for replenishment invoice ${invoiceId}`, type: 'pdf_generation', metadata: { invoiceId, tenantId: tenant } },
          { stepName: `Email Sending for replenishment invoice ${invoiceId}`, type: 'email_sending', metadata: { invoiceId, tenantId: tenant } },
        ],
        metadata: { user_id: 'system', invoice_count: 1, tenantId: tenant },
      });
      await tenantDb(knex, tenant).table('prepaid_balance_alerts')
        .where({ alert_id: alertId, replenishment_invoice_id: invoiceId, replenishment_status: 'pending' })
        .update({ replenishment_status: 'issued', updated_at: knex.fn.now() });
    } catch (error) {
      await tenantDb(knex, tenant).table('prepaid_balance_alerts')
        .where({ alert_id: alertId, replenishment_invoice_id: invoiceId })
        .update({
          replenishment_status: 'failed',
          replenishment_attempt_count: knex.raw('LEAST(COALESCE(replenishment_attempt_count, 0) + 1, 100)'),
          replenishment_error: String(error instanceof Error ? error.message : error).slice(0, 1000),
          updated_at: knex.fn.now(),
        });
      return { result: 'failed', autoIssue };
    }
  }

  return { result, autoIssue };
}

export async function replenishOpenPrepaidBalanceAlerts(
  knex: Knex,
  tenant: string,
  clientId?: string,
): Promise<PrepaidAutoReplenishmentSummary> {
  const db = tenantDb(knex, tenant);
  const query = db.table('prepaid_balance_alerts')
    .whereNull('resolved_at')
    .whereIn('alert_type', ['credit', 'bucket', 'prepaid_block']);
  if (clientId) {
    query.where({ client_id: clientId });
  }
  const alerts = await query
    .select('alert_id');
  const summary: PrepaidAutoReplenishmentSummary = {
    considered: alerts.length,
    created: 0,
    autoIssued: 0,
    skipped: 0,
    unchanged: 0,
    failed: 0,
  };
  for (const alert of alerts) {
    let outcome: { result: ReplenishmentResult; autoIssue: boolean };
    try {
      outcome = await processAlert(knex, tenant, alert.alert_id);
    } catch (error) {
      // A single malformed policy, invoice insert, or delivery enqueue must
      // not abort the tenant scan. Failed rows have no invoice lock and are
      // retryable on the next scan; the bounded attempt/error fields make the
      // failure observable without creating duplicates.
      await tenantDb(knex, tenant).table('prepaid_balance_alerts')
        .where({ alert_id: alert.alert_id, resolved_at: null })
        .update({
          replenishment_status: 'failed',
          replenishment_attempted_at: knex.fn.now(),
          replenishment_attempt_count: knex.raw('LEAST(COALESCE(replenishment_attempt_count, 0) + 1, 100)'),
          replenishment_error: String(error instanceof Error ? error.message : error).slice(0, 1000),
          updated_at: knex.fn.now(),
        });
      summary.failed += 1;
      continue;
    }
    summary[outcome.result] += 1;
    if (outcome.result === 'created' && outcome.autoIssue) summary.autoIssued += 1;
  }
  return summary;
}
