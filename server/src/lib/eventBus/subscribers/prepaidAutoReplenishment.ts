import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { createPrepaidReplenishmentInvoice } from '@alga-psa/billing/lib/prepaidAutoReplenishment';
import { finalizeInvoiceWithKnex } from '@alga-psa/billing/actions/invoiceModification';
import { enqueueImmediateJob } from '@alga-psa/core';

type AlertRow = {
  alert_id: string;
  client_id: string;
  alert_type: 'credit' | 'bucket';
  resolved_at: string | null;
  replenishment_status: string | null;
  replenishment_invoice_id: string | null;
  replenishment_credit_amount: number | string | null;
  replenishment_bucket_minutes: number | string | null;
  credit_currency_code: string | null;
  service_catalog_id: string | null;
  contract_line_id: string | null;
  bucket_usage_id: string | null;
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
  if (alert.alert_type !== 'bucket' || !alert.contract_line_id) return null;
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

  const result = await knex.transaction(async (trx) => {
    const db = tenantDb(trx, tenant);
    const alert = await db.table('prepaid_balance_alerts')
      .where({ alert_id: alertId, resolved_at: null })
      .forUpdate()
      .first() as AlertRow | undefined;
    if (!alert) return 'unchanged' as const;

    const settings = await db.table('client_billing_settings')
      .where({ client_id: alert.client_id })
      .first(
        'prepaid_replenishment_tier',
        'prepaid_credit_replenishment_amount',
        'prepaid_bucket_replenishment_minutes',
        'prepaid_replenishment_horizon_days',
      );
    const contract = await getAlertContract(trx, tenant, alert);
    if (alert.alert_type === 'bucket' && !contract) {
      await db.table('prepaid_balance_alerts').where({ alert_id: alert.alert_id }).update({
        replenishment_status: 'skipped',
        replenishment_attempted_at: trx.fn.now(),
        replenishment_error: 'Bucket alert is not linked to an active client contract',
        updated_at: trx.fn.now(),
      });
      return 'skipped' as const;
    }
    const tier = contract?.prepaid_replenishment_tier ?? settings?.prepaid_replenishment_tier ?? 'draft';
    const amount = Number(alert.alert_type === 'credit'
      ? (contract?.prepaid_credit_replenishment_amount ?? settings?.prepaid_credit_replenishment_amount)
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
      currencyCode: alert.credit_currency_code ?? client.default_currency_code ?? 'USD',
      serviceId: alert.service_catalog_id,
      serviceName,
      hourlyRate,
      bucketUsageId: alert.bucket_usage_id,
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
        deferPrepaidActivation: true,
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
    .whereIn('alert_type', ['credit', 'bucket']);
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
