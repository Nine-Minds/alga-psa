import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { createPrepaidReplenishmentInvoice } from '@alga-psa/billing/lib/prepaidAutoReplenishment';
import { finalizeInvoiceWithKnex } from '@alga-psa/billing/actions/invoiceModification';

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
};

type ReplenishmentResult = 'created' | 'skipped' | 'unchanged' | 'failed';

type ContractHorizonRow = {
  end_date: string | Date | null;
  renewal_mode: string | null;
  decision_due_date: string | Date | null;
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

async function hasContractTerminatingWithinHorizon(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  horizonDays: number,
): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  const horizon = isoDateDaysFromNow(horizonDays);
  const db = tenantDb(trx, tenant);
  const query = db.table('client_contracts as cc')
    .select('cc.end_date', 'cc.renewal_mode', 'cc.decision_due_date')
    .where({ 'cc.client_id': clientId, 'cc.is_active': true })
    .where((builder) => builder.whereNull('cc.start_date').orWhere('cc.start_date', '<=', today))
    .where((builder) => builder.whereNull('cc.end_date').orWhere('cc.end_date', '>=', today));
  db.tenantJoin(query, 'contracts as c', 'c.contract_id', 'cc.contract_id');

  const contracts = await query as ContractHorizonRow[];
  return contracts.some((contract) => {
    const decisionDate = contract.renewal_mode === 'none'
      ? contract.end_date
      : contract.decision_due_date ?? contract.end_date;
    if (!decisionDate) return false;
    const date = new Date(decisionDate).toISOString().slice(0, 10);
    return date >= today && date <= horizon;
  });
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
    const tier = settings?.prepaid_replenishment_tier ?? 'draft';
    const amount = Number(alert.alert_type === 'credit'
      ? settings?.prepaid_credit_replenishment_amount
      : settings?.prepaid_bucket_replenishment_minutes);
    if (tier === 'notify' || !Number.isSafeInteger(amount) || amount <= 0) {
      return 'unchanged' as const;
    }

    if (alert.replenishment_invoice_id && TERMINAL_REPLENISHMENT_STATES.has(alert.replenishment_status ?? '')) {
      return 'unchanged' as const;
    }

    if (await hasContractTerminatingWithinHorizon(
      trx,
      tenant,
      alert.client_id,
      Number(settings?.prepaid_replenishment_horizon_days ?? 30),
    )) {
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
        replenishment_error: null,
        updated_at: trx.fn.now(),
      });
    return 'created' as const;
  });

  if (result === 'created' && autoIssue && invoiceId) {
    try {
      // System finalization uses the same invoice lifecycle but does not draw
      // down existing credit against the replenishment invoice itself.
      await finalizeInvoiceWithKnex(invoiceId, knex, tenant, null, { skipAutoApply: true });
      await tenantDb(knex, tenant).table('prepaid_balance_alerts')
        .where({ alert_id: alertId, replenishment_invoice_id: invoiceId })
        .update({ replenishment_status: 'issued', updated_at: knex.fn.now() });
    } catch (error) {
      await tenantDb(knex, tenant).table('prepaid_balance_alerts')
        .where({ alert_id: alertId, replenishment_invoice_id: invoiceId })
        .update({
          replenishment_status: 'failed',
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
    const outcome = await processAlert(knex, tenant, alert.alert_id);
    summary[outcome.result] += 1;
    if (outcome.result === 'created' && outcome.autoIssue) summary.autoIssued += 1;
  }
  return summary;
}
