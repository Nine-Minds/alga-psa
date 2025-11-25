/**
 * Invoice server actions
 *
 * These are Next.js server actions for invoice operations.
 * They handle validation, authorization, and delegate to the repository.
 */

'use server';

import { createInvoiceRepository } from '../repositories/index.js';
import {
  createManualInvoiceSchema,
  updateInvoiceSchema,
  generateInvoiceSchema,
  finalizeInvoiceSchema,
  type Invoice,
  type InvoiceFilters,
  type InvoiceListResponse,
  type InvoiceWithItems,
  type CreateManualInvoiceInput,
  type UpdateInvoiceInput,
  type GenerateInvoiceInput,
  type FinalizeInvoiceInput,
} from '../types/index.js';

// Note: In the real implementation, these would import from @alga-psa/database
// For now, we define the types that will be injected
type Knex = import('knex').Knex;

/**
 * Server action context provided by the app shell
 */
interface ActionContext {
  tenantId: string;
  userId: string;
  knex: Knex;
}

/**
 * Get a list of invoices for the current tenant
 */
export async function getInvoices(
  context: ActionContext,
  filters: InvoiceFilters = {}
): Promise<InvoiceListResponse> {
  const repo = createInvoiceRepository(context.knex);
  return repo.findMany(context.tenantId, filters);
}

/**
 * Get a single invoice by ID
 */
export async function getInvoice(
  context: ActionContext,
  invoiceId: string,
  withItems: boolean = true
): Promise<Invoice | InvoiceWithItems | null> {
  const repo = createInvoiceRepository(context.knex);

  if (withItems) {
    return repo.findByIdWithItems(context.tenantId, invoiceId);
  }

  return repo.findById(context.tenantId, invoiceId);
}

/**
 * Create a manual invoice
 *
 * This action creates an invoice manually with specified line items.
 * It validates the input, creates the invoice record, adds items,
 * calculates taxes, and updates totals.
 */
export async function createManualInvoice(
  context: ActionContext,
  input: CreateManualInvoiceInput
): Promise<{ success: true; invoice: InvoiceWithItems } | { success: false; error: string }> {
  // Validate input
  const validation = createManualInvoiceSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createInvoiceRepository(context.knex);
    const { items, client_id, invoice_date, due_date, is_prepayment, expiration_date } = validation.data;

    // Generate invoice number (would call a service in real implementation)
    const invoiceNumber = `INV-${Date.now()}`; // Placeholder

    // Create invoice record
    const invoice = await repo.create(context.tenantId, {
      client_id,
      invoice_number: invoiceNumber,
      invoice_date: invoice_date || new Date().toISOString().split('T')[0],
      due_date: due_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status: is_prepayment ? 'prepayment' : 'draft',
      is_manual: true,
      subtotal: 0,
      tax: 0,
      total_amount: 0,
      credit_applied: 0,
    });

    // Add items
    const createdItems = await repo.addItems(
      context.tenantId,
      invoice.invoice_id,
      items,
      context.userId
    );

    // Calculate totals
    const subtotal = createdItems.reduce((sum, item) => sum + item.total_price, 0);
    const tax = 0; // Tax calculation would happen here in real implementation
    const total_amount = subtotal + tax;

    // Update totals
    await repo.updateTotals(context.tenantId, invoice.invoice_id, {
      subtotal,
      tax,
      total_amount,
    });

    // Fetch complete invoice
    const completeInvoice = await repo.findByIdWithItems(context.tenantId, invoice.invoice_id);

    if (!completeInvoice) {
      return { success: false, error: 'Failed to retrieve created invoice' };
    }

    return { success: true, invoice: completeInvoice };
  } catch (error) {
    console.error('[invoicing/actions] Failed to create manual invoice:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create manual invoice',
    };
  }
}

/**
 * Update an existing invoice
 */
export async function updateInvoice(
  context: ActionContext,
  input: UpdateInvoiceInput
): Promise<{ success: true; invoice: Invoice } | { success: false; error: string }> {
  // Validate input
  const validation = updateInvoiceSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createInvoiceRepository(context.knex);
    const { invoice_id, ...updateData } = validation.data;

    const invoice = await repo.update(context.tenantId, invoice_id, updateData);

    if (!invoice) {
      return { success: false, error: 'Invoice not found' };
    }

    return { success: true, invoice };
  } catch (error) {
    console.error('[invoicing/actions] Failed to update invoice:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update invoice',
    };
  }
}

/**
 * Delete an invoice (soft delete - marks as cancelled)
 */
export async function deleteInvoice(
  context: ActionContext,
  invoiceId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const repo = createInvoiceRepository(context.knex);
    const deleted = await repo.delete(context.tenantId, invoiceId);

    if (!deleted) {
      return { success: false, error: 'Invoice not found' };
    }

    return { success: true };
  } catch (error) {
    console.error('[invoicing/actions] Failed to delete invoice:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete invoice',
    };
  }
}

/**
 * Generate an invoice from a billing cycle
 *
 * This action generates an invoice based on billable time entries,
 * usage, and fixed-price items for a client in a given billing period.
 */
export async function generateInvoice(
  context: ActionContext,
  input: GenerateInvoiceInput
): Promise<{ success: true; invoice: InvoiceWithItems } | { success: false; error: string }> {
  // Validate input
  const validation = generateInvoiceSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createInvoiceRepository(context.knex);
    const {
      client_id,
      billing_cycle_id,
      cycle_start,
      cycle_end,
      include_time_entries,
      include_usage,
      include_fixed,
    } = validation.data;

    // In a real implementation, this would:
    // 1. Query billable time entries for the period
    // 2. Query usage records for the period
    // 3. Query fixed-price contract items
    // 4. Run the billing engine to calculate charges
    // 5. Apply tax calculations
    // 6. Create invoice with all items

    // For now, create a placeholder invoice
    const invoiceNumber = `INV-${Date.now()}`; // Placeholder

    const invoice = await repo.create(context.tenantId, {
      client_id,
      billing_cycle_id,
      invoice_number: invoiceNumber,
      invoice_date: new Date().toISOString().split('T')[0],
      due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status: 'draft',
      is_manual: false,
      subtotal: 0,
      tax: 0,
      total_amount: 0,
      credit_applied: 0,
    });

    // Fetch complete invoice
    const completeInvoice = await repo.findByIdWithItems(context.tenantId, invoice.invoice_id);

    if (!completeInvoice) {
      return { success: false, error: 'Failed to retrieve generated invoice' };
    }

    return { success: true, invoice: completeInvoice };
  } catch (error) {
    console.error('[invoicing/actions] Failed to generate invoice:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate invoice',
    };
  }
}

/**
 * Finalize an invoice
 *
 * This action marks an invoice as finalized, preventing further edits.
 * Optionally sends the invoice to the client.
 */
export async function finalizeInvoice(
  context: ActionContext,
  input: FinalizeInvoiceInput
): Promise<{ success: true; invoice: Invoice } | { success: false; error: string }> {
  // Validate input
  const validation = finalizeInvoiceSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createInvoiceRepository(context.knex);
    const { invoice_id, send_to_client } = validation.data;

    // Check if invoice exists and is in draft status
    const existingInvoice = await repo.findById(context.tenantId, invoice_id);
    if (!existingInvoice) {
      return { success: false, error: 'Invoice not found' };
    }

    if (existingInvoice.status !== 'draft' && existingInvoice.status !== 'pending') {
      return { success: false, error: 'Invoice is already finalized' };
    }

    // Finalize the invoice
    const invoice = await repo.finalize(context.tenantId, invoice_id);

    if (!invoice) {
      return { success: false, error: 'Failed to finalize invoice' };
    }

    // In a real implementation, if send_to_client is true:
    // 1. Generate PDF
    // 2. Send email to client
    // 3. Log the activity

    return { success: true, invoice };
  } catch (error) {
    console.error('[invoicing/actions] Failed to finalize invoice:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to finalize invoice',
    };
  }
}

/**
 * Send an invoice to a client
 *
 * This action sends a finalized invoice to the client via email.
 */
export async function sendInvoice(
  context: ActionContext,
  invoiceId: string,
  recipientEmail?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const repo = createInvoiceRepository(context.knex);

    // Check if invoice exists and is finalized
    const invoice = await repo.findById(context.tenantId, invoiceId);
    if (!invoice) {
      return { success: false, error: 'Invoice not found' };
    }

    if (invoice.status === 'draft') {
      return { success: false, error: 'Cannot send a draft invoice. Please finalize it first.' };
    }

    // In a real implementation, this would:
    // 1. Generate or retrieve PDF
    // 2. Get client contact details if recipientEmail not provided
    // 3. Send email with PDF attachment
    // 4. Log the activity
    // 5. Update invoice status if needed

    return { success: true };
  } catch (error) {
    console.error('[invoicing/actions] Failed to send invoice:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send invoice',
    };
  }
}
