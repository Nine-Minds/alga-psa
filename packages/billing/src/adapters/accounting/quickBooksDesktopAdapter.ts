import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { AccountingMappingResolver } from '../../services/accountingMappingResolver';
import { expandAccountingExportCharges } from '../../services/accountingExportChargeExpansion';
import logger from '@alga-psa/core/logger';
import {
  AccountingExportAdapter,
  AccountingExportAdapterCapabilities,
  AccountingExportAdapterContext,
  AccountingExportDeliveryResult,
  AccountingExportTransformResult
} from '@alga-psa/types';

export class QuickBooksDesktopAdapter implements AccountingExportAdapter {
  static readonly TYPE = 'quickbooks_desktop';

  static async create(): Promise<QuickBooksDesktopAdapter> {
    return new QuickBooksDesktopAdapter();
  }

  readonly type = QuickBooksDesktopAdapter.TYPE;

  capabilities(): AccountingExportAdapterCapabilities {
    return {
      deliveryMode: 'file',
      supportedExportTypes: ['invoice'],
      supportsPartialRetry: false,
      supportsInvoiceUpdates: false
    };
  }

  async transform(context: AccountingExportAdapterContext): Promise<AccountingExportTransformResult> {
    const { knex } = await createTenantKnex();
    const tenant = context.batch.tenant;
    if (!tenant) throw new Error('Tenant context required');
    const db = tenantDb(knex, tenant);
    const rows = await db.table('invoice_charges').whereIn('item_id', context.lines.map(line => line.document_line_id).filter((id): id is string => Boolean(id))).select('*');
    const expanded = await expandAccountingExportCharges(knex, tenant, new Map(rows.map(row => [row.item_id, row])), context.lines);
    const resolver = new AccountingMappingResolver(knex, undefined, tenant);
    const escape = (value: unknown) => String(value ?? '').replace(/[\t\r\n]/g, ' ');
    const money = (cents: number) => (cents / 100).toFixed(2);
    const output = [
      '!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO',
      '!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO',
      '!ENDTRNS',
    ];
    for (const invoiceId of new Set(expanded.lines.map(line => line.document_id))) {
      const invoice = await db.table('invoices').where({ invoice_id: invoiceId }).first();
      if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
      const client = await db.table('clients').where({ client_id: invoice.client_id }).first();
      const customerMapping = await resolver.resolveClientMapping({ tenantId: tenant, adapterType: this.type, clientId: invoice.client_id, targetRealm: context.batch.target_realm });
      const customer = customerMapping?.external_entity_id ?? client?.client_name;
      if (!customer) throw new Error(`Configure a Desktop customer for invoice ${invoice.invoice_number}`);
      const day = new Date(invoice.invoice_date);
      const date = `${day.getUTCMonth() + 1}/${day.getUTCDate()}/${day.getUTCFullYear()}`;
      const splits: string[] = [];
      let total = 0;
      for (const line of expanded.lines.filter(line => line.document_id === invoiceId)) {
        const charge = expanded.charges.get(line.document_line_id ?? '');
        if (!charge) throw new Error(`Invoice line ${line.document_line_id} not found`);
        const mapping = charge.is_discount
          ? await resolver.resolveDiscountMapping({ tenantId: tenant, adapterType: this.type, targetRealm: context.batch.target_realm })
          : charge.service_id ? await resolver.resolveServiceMapping({ tenantId: tenant, adapterType: this.type, serviceId: charge.service_id, targetRealm: context.batch.target_realm }) : null;
        if (!mapping) throw new Error(charge.is_discount ? 'Configure the Desktop discount account mapping.' : `Assign a mapped service to '${charge.description}'.`);
        const net = Number(charge.net_amount);
        const tax = Number(charge.tax_amount ?? 0);
        if (!Number.isSafeInteger(net) || !Number.isSafeInteger(tax)) throw new Error('Invoice amounts must be integer minor units.');
        splits.push(['SPL', charge.item_id, 'INVOICE', date, mapping.external_entity_id, customer, money(-net), invoice.invoice_number, charge.description].map(escape).join('\t'));
        if (tax) {
          const taxMapping = await resolver.resolveTaxCodeMapping({ tenantId: tenant, adapterType: this.type, taxRegionId: charge.tax_region, targetRealm: context.batch.target_realm });
          if (!taxMapping) throw new Error(`Configure a Desktop tax account mapping for ${charge.tax_region}.`);
          splits.push(['SPL', `${charge.item_id}-tax`, 'INVOICE', date, taxMapping.external_entity_id, customer, money(-tax), invoice.invoice_number, charge.description].map(escape).join('\t'));
        }
        total += net + tax;
      }
      output.push(['TRNS', invoiceId, 'INVOICE', date, 'Accounts Receivable', customer, money(total), invoice.invoice_number, invoice.invoice_number].map(escape).join('\t'), ...splits, 'ENDTRNS');
    }
    const content = output.join('\n');

    return {
      documents: [
        {
          documentId: context.batch.batch_id,
          lineIds: context.lines.map((line) => line.line_id),
          payload: {
            type: 'quickbooks_desktop_iif',
            batchId: context.batch.batch_id,
            generatedAt: new Date().toISOString()
          }
        }
      ],
      files: [
        {
          filename: `accounting-export-${context.batch.batch_id}.iif`,
          contentType: 'text/plain',
          content
        }
      ],
      metadata: {
        adapter: this.type,
        fileSize: content.length,
        lineCount: context.lines.length
      }
    };
  }

  async deliver(
    transformResult: AccountingExportTransformResult,
    context: AccountingExportAdapterContext
  ): Promise<AccountingExportDeliveryResult> {
    const artifact = transformResult.files?.[0];
    logger.info('[QuickBooksDesktopAdapter] Prepared IIF artifact', {
      batchId: context.batch.batch_id,
      filename: artifact?.filename
    });

    const deliveredLines = transformResult.documents.flatMap((doc) =>
      doc.lineIds.map((lineId) => ({
        lineId,
        externalDocumentRef: artifact?.filename ?? null
      }))
    );

    return {
      deliveredLines,
      artifacts: {
        file: artifact
      },
      metadata: {
        adapter: this.type,
        artifactPrepared: Boolean(artifact)
      }
    };
  }
}
