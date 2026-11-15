'use server';

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { TaxSource } from '@alga-psa/types';
import { getTaxImportState } from '@alga-psa/types';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { assertInvoiceNotExported } from '../services/accountingSync/invoiceExportGuards';
import {
  actionError,
  isActionMessageError,
  isActionPermissionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

/**
 * Client-specific tax source resolution result.
 * Note: The accounting adapter is determined automatically based on which system
 * the invoice is exported to (from tenant_external_entity_mappings), not configured here.
 */
export interface ClientTaxSourceInfo {
  taxSource: TaxSource;
  isOverride: boolean;
}

type TaxSourceActionError = ActionMessageError | ActionPermissionError;

/**
 * Get the effective tax source for a client.
 * Checks client override first, then falls back to tenant settings.
 * Note: The adapter is NOT returned here - it's determined at export time
 * based on which accounting system the invoice is exported to.
 */
export const getEffectiveTaxSourceForClient = withAuth(async (
  _user,
  { tenant },
  clientId: string
): Promise<ClientTaxSourceInfo | TaxSourceActionError> => {
  if (!await hasPermission(_user, 'billing', 'read')) {
    return permissionError('Permission denied: billing read required', 'msp/billing:errors.permissions.billingRead');
  }
  const { knex } = await createTenantKnex();

  if (!tenant) {
    return {
      taxSource: 'internal',
      isOverride: false
    };
  }

  const db = tenantDb(knex, tenant);

  // First check if the client has an override
  const clientSettings = await db.table('client_tax_settings')
    .where({ client_id: clientId })
    .select('tax_source_override')
    .first();

  if (clientSettings?.tax_source_override) {
    return {
      taxSource: clientSettings.tax_source_override as TaxSource,
      isOverride: true
    };
  }

  // Fall back to tenant settings
  const tenantSettings = await db.table('tenant_settings')
    .select('default_tax_source', 'allow_external_tax_override')
    .first();

  return {
    taxSource: (tenantSettings?.default_tax_source as TaxSource) || 'internal',
    isOverride: false
  };
});

/**
 * Determine if an invoice should use external tax delegation.
 * This should be called during invoice creation to set the initial tax_source.
 */
export const shouldUseTaxDelegation = withAuth(async (_user, ctx, clientId: string): Promise<boolean> => {
  const result = await getEffectiveTaxSourceForClient(clientId);
  if (isActionMessageError(result) || isActionPermissionError(result)) {
    return false;
  }
  return result.taxSource === 'external';
});

/**
 * Get the initial tax_source value for a new invoice based on client settings.
 * Returns 'pending_external' for external delegation, 'internal' otherwise.
 */
export const getInitialInvoiceTaxSource = withAuth(async (_user, ctx, clientId: string): Promise<TaxSource | TaxSourceActionError> => {
  const result = await getEffectiveTaxSourceForClient(clientId);
  if (isActionMessageError(result) || isActionPermissionError(result)) {
    return result as TaxSourceActionError;
  }

  // If client uses external tax, new invoices start as 'pending_external'
  if (result.taxSource === 'external') {
    return 'pending_external';
  }

  return 'internal';
});

/**
 * Validate that an invoice can be finalized based on its tax source.
 * Returns an error message if finalization should be blocked.
 */
/**
 * Machine-readable reason a finalization was blocked. Lets callers (UI) react to a
 * specific cause without string-matching the human-readable `error` message — which
 * matters because thrown server-action errors are masked in production, so the UI
 * relies on this returned shape rather than a caught exception.
 */
export type InvoiceFinalizationBlockCode =
  | 'no_tenant'
  | 'not_found'
  | 'already_finalized'
  | 'pending_external_tax';

export interface InvoiceFinalizationValidation {
  canFinalize: boolean;
  code?: InvoiceFinalizationBlockCode;
  error?: string;
  warning?: string;
}

export async function validateInvoiceFinalizationInternal(
  knex: Knex,
  tenant: string,
  invoiceId: string,
): Promise<InvoiceFinalizationValidation> {
  if (!tenant) {
    return { canFinalize: false, code: 'no_tenant', error: 'No tenant context' };
  }

  const db = tenantDb(knex, tenant);

  const invoice = await db.table('invoices')
    .where({ invoice_id: invoiceId })
    .select('tax_source', 'status')
    .first();

  if (!invoice) {
    return { canFinalize: false, code: 'not_found', error: 'Invoice not found' };
  }

  if (invoice.status === 'finalized' || invoice.status === 'paid') {
    return { canFinalize: false, code: 'already_finalized', error: 'Invoice is already finalized' };
  }

  // Finalization gating is import-state driven; canonical recurring service periods do not
  // create a separate tax-finalization path here.
  if (getTaxImportState(invoice.tax_source as TaxSource) === 'pending') {
    return {
      canFinalize: false,
      code: 'pending_external_tax',
      error: 'Cannot finalize invoice with pending external tax. Please import tax from the accounting system first.',
      warning: 'Invoice has external tax delegation enabled but tax has not been imported yet.'
    };
  }

  return { canFinalize: true };
}

export const validateInvoiceFinalization = withAuth(async (
  _user,
  { tenant },
  invoiceId: string
): Promise<InvoiceFinalizationValidation | TaxSourceActionError> => {
  if (!await hasPermission(_user, 'billing', 'read')) {
    return permissionError('Permission denied: billing read required', 'msp/billing:errors.permissions.billingRead');
  }
  const { knex } = await createTenantKnex();
  return validateInvoiceFinalizationInternal(knex, tenant, invoiceId);
});

export type InvoiceTaxSourceChangeResult = { success: true } | { success: false; error: string };

/**
 * Change an invoice's tax source inside the caller's transaction. Shared by
 * the server action and the REST invoice update so the two cannot drift.
 *
 * A draft may move in either direction; its tax is recomputed and any change
 * to the total is booked against the client balance. A finalized invoice may
 * only move from internal tax to pending delegation, and only while it has
 * never reached an accounting system: amounts stay as they are, the export
 * then delegates tax and the import back replaces them (alga-2026-0002886).
 */
export async function changeInvoiceTaxSourceInternal(
  trx: Knex.Transaction,
  tenant: string,
  invoiceId: string,
  newTaxSource: TaxSource
): Promise<InvoiceTaxSourceChangeResult> {
  const db = tenantDb(trx, tenant);
  const invoice = await db.table('invoices')
    .where({ invoice_id: invoiceId })
    .select(
      'status',
      'tax_source',
      'client_id',
      'invoice_number',
      'total_amount',
    )
    .forUpdate()
    .first();

  if (!invoice) {
    return { success: false, error: 'Invoice not found' };
  }
  if (invoice.tax_source === newTaxSource) {
    return { success: true };
  }

  if (invoice.status !== 'draft') {
    if (invoice.status === 'cancelled') {
      return { success: false, error: 'Cannot change tax source on a cancelled invoice' };
    }
    if (invoice.tax_source !== 'internal' || newTaxSource !== 'pending_external') {
      return {
        success: false,
        error: 'A finalized invoice can only be switched from internal tax to accounting-system tax delegation',
      };
    }
    try {
      await assertInvoiceNotExported(trx, tenant, invoiceId, 'change_tax_source');
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
    await db.table('invoices')
      .where({ invoice_id: invoiceId })
      .update({
        tax_source: newTaxSource,
        updated_at: trx.fn.now(),
      });
    return { success: true };
  }

  const totalBefore = Math.round(Number(invoice.total_amount ?? 0));
  if (
    (invoice.tax_source === 'external' || invoice.tax_source === 'pending_external') &&
    newTaxSource === 'internal'
  ) {
    await db.table('invoice_charges')
      .where({ invoice_id: invoiceId })
      .update({
        external_tax_amount: null,
        external_tax_code: null,
        external_tax_rate: null,
        updated_at: trx.fn.now(),
      });
  }

  await db.table('invoices')
    .where({ invoice_id: invoiceId })
    .update({
      tax_source: newTaxSource,
      updated_at: trx.fn.now(),
    });

  // Import lazily to avoid the invoiceService -> invoiceGeneration ->
  // taxSourceActions module cycle during server-action initialization.
  const [{ calculateAndDistributeTax, getClientDetails }, { TaxService }] = await Promise.all([
    import('../services/invoiceService'),
    import('../services/taxService'),
  ]);
  const client = await getClientDetails(trx, tenant, invoice.client_id);
  await calculateAndDistributeTax(trx, invoiceId, client, new TaxService(), tenant);

  const charges = await db.table('invoice_charges')
    .where({ invoice_id: invoiceId })
    .select('net_amount', 'tax_amount');
  const subtotal = Math.round(charges.reduce(
    (sum, charge) => sum + Number(charge.net_amount ?? 0),
    0,
  ));
  const tax = Math.round(charges.reduce(
    (sum, charge) => sum + Number(charge.tax_amount ?? 0),
    0,
  ));
  const total = subtotal + tax;
  await db.table('invoices')
    .where({ invoice_id: invoiceId })
    .update({ subtotal, tax, total_amount: total, updated_at: trx.fn.now() });

  const delta = total - totalBefore;
  if (delta !== 0) {
    const lastTransaction = await db.table('transactions')
      .where({ client_id: invoice.client_id })
      .orderBy('created_at', 'desc')
      .first();
    const currentBalance = Number(lastTransaction?.balance_after ?? 0);
    await db.table('transactions').insert({
      transaction_id: uuidv4(),
      client_id: invoice.client_id,
      invoice_id: invoiceId,
      amount: delta,
      type: 'invoice_adjustment',
      status: 'completed',
      description: `Changed tax source on invoice ${invoice.invoice_number}`,
      created_at: new Date().toISOString(),
      tenant,
      balance_after: currentBalance + delta,
    });
  }

  return { success: true };
}

/**
 * Update the tax source for an invoice. See changeInvoiceTaxSourceInternal for
 * which moves are allowed in which state.
 */
export const updateInvoiceTaxSource = withAuth(async (
  _user,
  { tenant },
  invoiceId: string,
  newTaxSource: TaxSource
): Promise<InvoiceTaxSourceChangeResult | TaxSourceActionError> => {
  if (!await hasPermission(_user, 'billing', 'update')) {
    return permissionError('Permission denied: billing update required', 'msp/billing:errors.permissions.billingUpdate');
  }
  const { knex } = await createTenantKnex();

  if (!tenant) {
    return { success: false, error: 'No tenant context' };
  }

  return withTransaction(knex, (trx: Knex.Transaction) =>
    changeInvoiceTaxSourceInternal(trx, tenant, invoiceId, newTaxSource)
  );
});

/**
 * Check if client is allowed to override tax source.
 * This is controlled by the tenant setting allow_external_tax_override.
 */
export const canClientOverrideTaxSource = withAuth(async (_user, { tenant }): Promise<boolean> => {
  const { knex } = await createTenantKnex();

  if (!tenant) {
    return false;
  }

  const db = tenantDb(knex, tenant);

  const tenantSettings = await db.table('tenant_settings')
    .select('allow_external_tax_override')
    .first();

  return Boolean(tenantSettings?.allow_external_tax_override);
});
