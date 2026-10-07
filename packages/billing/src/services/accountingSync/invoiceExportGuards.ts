import { Knex } from 'knex';

export type ExportedInvoiceAction = 'unfinalize' | 'delete' | 'edit';

export async function findInvoiceExportInProgress(
  knex: Knex,
  tenant: string,
  invoiceId: string
): Promise<{ id: string } | undefined> {
  return knex('accounting_export_lines as line')
    .join('accounting_export_batches as batch', function joinBatch() {
      this.on('batch.tenant', '=', 'line.tenant').andOn('batch.batch_id', '=', 'line.batch_id');
    })
    .where({ 'line.tenant': tenant, 'batch.tenant': tenant, 'line.document_id': invoiceId, 'batch.status': 'validating' })
    .first('line.line_id as id');
}

const BLOCK_MESSAGES: Record<ExportedInvoiceAction, string> = {
  unfinalize:
    'This invoice is synced to an accounting system — it cannot be reopened. Void it and reissue, or issue a credit note for the difference.',
  delete: 'This invoice is synced to an accounting system — void it instead of deleting.',
  edit:
    'This invoice is synced to an accounting system — adjustments are locked. Void it and reissue, or issue a credit note for the difference.'
};

export async function findInvoiceAccountingMapping(
  knex: Knex,
  tenant: string,
  invoiceId: string
): Promise<{ id: string } | undefined> {
  const mapped = await knex('tenant_external_entity_mappings')
    .where({
      tenant,
      alga_entity_type: 'invoice',
      alga_entity_id: invoiceId
    })
    .first('id');
  if (mapped) return mapped;

  // File exports don't create a provider mapping in every adapter. A delivered
  // export line is persisted evidence of delivery; batch membership alone is
  // insufficient because failed/cancelled batches may retain their lines.
  return knex('accounting_export_lines as line')
    .join('accounting_export_batches as batch', function joinBatch() {
      this.on('batch.tenant', '=', 'line.tenant')
        .andOn('batch.batch_id', '=', 'line.batch_id');
    })
    .where({ 'line.tenant': tenant, 'batch.tenant': tenant, 'line.document_id': invoiceId })
    .whereIn('batch.adapter_type', ['quickbooks_csv', 'quickbooks_desktop', 'xero_csv'])
    .where((query) => query.whereIn('line.status', ['delivered', 'posted'])
      .orWhereIn('batch.status', ['delivered', 'posted']))
    .first('line.line_id as id');
}

/**
 * Guard for actions that would desynchronize an exported document. An invoice
 * with an accounting mapping is posted in the external system's books;
 * unfinalizing or deleting it in Alga leaves the two systems disagreeing about
 * a posted document (and a later re-finalize would export into reconciled
 * history). The supported flows are void (which propagates) or a credit note
 * for the difference.
 */
export async function assertInvoiceNotExported(
  knex: Knex,
  tenant: string,
  invoiceId: string,
  action: ExportedInvoiceAction
): Promise<void> {
  if (await findInvoiceExportInProgress(knex, tenant, invoiceId)) {
    throw new Error('An accounting export is being prepared for this invoice. Wait for it to finish before changing the invoice.');
  }
  const mapping = await findInvoiceAccountingMapping(knex, tenant, invoiceId);
  if (mapping) {
    throw new Error(BLOCK_MESSAGES[action]);
  }
}
