import { Knex } from 'knex';

const ACCOUNTING_INTEGRATION_TYPE = 'quickbooks_online';

export type ExportedInvoiceAction = 'unfinalize' | 'delete';

const BLOCK_MESSAGES: Record<ExportedInvoiceAction, string> = {
  unfinalize:
    'This invoice is synced to an accounting system — it cannot be reopened. Void it and reissue, or issue a credit note for the difference.',
  delete: 'This invoice is synced to an accounting system — void it instead of deleting.'
};

export async function findInvoiceAccountingMapping(
  knex: Knex,
  tenant: string,
  invoiceId: string
): Promise<{ id: string } | undefined> {
  return knex('tenant_external_entity_mappings')
    .where({
      tenant,
      integration_type: ACCOUNTING_INTEGRATION_TYPE,
      alga_entity_type: 'invoice',
      alga_entity_id: invoiceId
    })
    .first('id');
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
  const mapping = await findInvoiceAccountingMapping(knex, tenant, invoiceId);
  if (mapping) {
    throw new Error(BLOCK_MESSAGES[action]);
  }
}
