import { WorkflowContext } from '@alga-psa/shared/workflow/core';
import { createTenantKnex } from '../db';
import { AccountingExportService } from '../services/accountingExportService';

const WorkflowState = {
  RUNNING: 'RUNNING',
  COMPLETE: 'COMPLETE',
  FAILED: 'FAILED'
} as const;

type InvoiceRow = {
  invoice_id: string;
  client_id?: string | null;
  currency_code?: string | null;
  exchange_rate_basis_points?: number | null;
};

type ChargeRow = {
  item_id: string;
  total_price: number | string | null;
  tax_amount?: number | string | null;
  tax_region?: string | null;
  service_id?: string | null;
};

export async function qboInvoiceSyncWorkflow(context: WorkflowContext): Promise<void> {
  const { logger, setState, tenant } = context;

  const invoiceId = extractInvoiceId(context);
  const realmId = extractRealmId(context);

  if (!tenant || !invoiceId || !realmId) {
    logger.error('qboInvoiceSyncWorkflow missing required context', {
      tenant,
      invoiceId,
      realmId,
      input: context.input
    });
    setState(WorkflowState.FAILED);
    return;
  }

  setState(WorkflowState.RUNNING);

  try {
    const { knex } = await createTenantKnex();

    const invoice = await knex<InvoiceRow>('invoices')
      .select('invoice_id', 'client_id', 'currency_code', 'exchange_rate_basis_points')
      .where({ tenant, invoice_id: invoiceId })
      .first();

    if (!invoice) {
      logger.error('qboInvoiceSyncWorkflow could not locate invoice', { tenant, invoiceId });
      setState(WorkflowState.FAILED);
      return;
    }

    const charges = await knex<ChargeRow>('invoice_charges')
      .select('item_id', 'total_price', 'tax_amount', 'tax_region', 'service_id')
      .where({ tenant, invoice_id: invoiceId });

    if (charges.length === 0) {
      logger.warn('qboInvoiceSyncWorkflow found no charges to export; skipping', { tenant, invoiceId });
      setState(WorkflowState.COMPLETE);
      return;
    }

    const exportService = await AccountingExportService.create();
    const batch = await exportService.createBatch({
      adapter_type: 'quickbooks_online',
      export_type: 'invoice',
      target_realm: realmId,
      filters: {
        source: 'workflow:qboInvoiceSyncWorkflow',
        invoice_ids: [invoiceId]
      },
      notes: `Automated export triggered by qboInvoiceSyncWorkflow at ${new Date().toISOString()}`
    });

    const lineInputs = charges.map((charge) => ({
      batch_id: batch.batch_id,
      invoice_id: invoice.invoice_id,
      invoice_charge_id: charge.item_id,
      client_id: invoice.client_id ?? null,
      amount_cents: toCents(charge.total_price),
      currency_code: invoice.currency_code ?? 'USD',
      exchange_rate_basis_points: invoice.exchange_rate_basis_points ?? null,
      payload: {
        tax_amount_cents: toCents(charge.tax_amount),
        tax_region: charge.tax_region ?? null,
        service_id: charge.service_id ?? null
      }
    }));

    await exportService.appendLines(batch.batch_id, { lines: lineInputs });
    const delivery = await exportService.executeBatch(batch.batch_id);

    logger.info('qboInvoiceSyncWorkflow completed accounting export', {
      tenant,
      invoiceId,
      realmId,
      batchId: batch.batch_id,
      deliveredLines: delivery.deliveredLines.length
    });

    setState(WorkflowState.COMPLETE);
  } catch (error) {
    logger.error('qboInvoiceSyncWorkflow failed during export', {
      tenant,
      invoiceId,
      realmId,
      error: error instanceof Error ? error.message : String(error)
    });
    setState(WorkflowState.FAILED);
    throw error;
  }
}

function extractInvoiceId(context: WorkflowContext): string | undefined {
  const input = context.input as Record<string, any> | undefined;
  const triggerEvent = input?.triggerEvent ?? context.data.get('triggerEvent');
  return (
    triggerEvent?.payload?.invoiceId ??
    input?.invoiceId ??
    input?.invoice_id ??
    context.data.get('invoiceId')
  );
}

function extractRealmId(context: WorkflowContext): string | undefined {
  const input = context.input as Record<string, any> | undefined;
  const triggerEvent = input?.triggerEvent ?? context.data.get('triggerEvent');
  return (
    triggerEvent?.payload?.realmId ??
    input?.realmId ??
    input?.targetRealm ??
    context.data.get('realmId')
  );
}

function toCents(value: number | string | null | undefined): number {
  if (typeof value === 'number') {
    return Math.round(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : 0;
  }
  return 0;
}
