'use server'

import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';
import { Session } from 'next-auth';
import { Temporal } from '@js-temporal/polyfill';
import { createTenantKnex } from 'server/src/lib/db';
import { toISODate } from 'server/src/lib/utils/dateTimeUtils';
// import { auditLog } from 'server/src/lib/logging/auditLog';
import ClientContractLine from 'server/src/lib/models/clientContractLine';
import { applyCreditToInvoice } from 'server/src/lib/actions/creditActions'; // Assuming this stays or moves appropriately
import { IInvoiceCharge, InvoiceViewModel, DiscountType } from 'server/src/interfaces/invoice.interfaces';
import { BillingEngine } from 'server/src/lib/billing/billingEngine';
import { persistInvoiceCharges, persistManualInvoiceCharges } from 'server/src/lib/services/invoiceService'; // Import persistManualInvoiceCharges
import Invoice from 'server/src/lib/models/invoice'; // Needed for getFullInvoiceById
import { v4 as uuidv4 } from 'uuid';
import { getWorkflowRuntime } from '@alga-psa/shared/workflow/core'; // Import runtime getter via package export
// import { getRedisStreamClient } from '@alga-psa/shared/workflow/streams/redisStreamClient'; // No longer directly used here
import { getEventBus } from 'server/src/lib/eventBus'; // Import EventBus
import { EventType as BusEventType } from '@alga-psa/shared/workflow/streams'; // For type safety
import { EventSubmissionOptions } from '@alga-psa/shared/workflow/core'; // Import type directly via package export
import { getSecretProviderInstance } from '@alga-psa/shared/core';
import { getSession } from 'server/src/lib/auth/getSession';

// Interface definitions specific to manual updates (might move to interfaces file later)
export interface ManualInvoiceUpdate {
  service_id?: string;
  description?: string;
  quantity?: number;
  rate?: number;
  item_id: string;
  is_discount?: boolean;
  discount_type?: DiscountType;
  discount_percentage?: number;
  applies_to_item_id?: string;
  is_taxable?: boolean; // Keep for purely manual items without service
}

interface ManualItemsUpdate {
  newItems: IInvoiceCharge[];
  updatedItems: ManualInvoiceUpdate[]; // This uses the interface above, but it's not used in the functions moved here? Recheck original file.
  removedItemIds: string[];
  invoice_number?: string; // Added based on usage in updateManualInvoiceItems
}


export async function finalizeInvoice(invoiceId: string): Promise<void> {
  const { knex, tenant } = await createTenantKnex();
  const session = await getSession();

  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  if (!tenant) {
    throw new Error('No tenant found');
  }

  await finalizeInvoiceWithKnex(invoiceId, knex, tenant, session.user.id);
}

export async function finalizeInvoiceWithKnex(
  invoiceId: string,
  knex: Knex,
  tenant: string,
  userId: string
): Promise<void> {
  let invoice: any;

  // First transaction to update invoice status
  await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Check if invoice exists and is not already finalized
    invoice = await trx('invoices')
      .where({
        invoice_id: invoiceId,
        tenant
      })
      .first();

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    if (invoice.finalized_at) {
      throw new Error('Invoice is already finalized');
    }

    await trx('invoices')
      .where({ invoice_id: invoiceId, tenant: tenant })
      .update({
        status: 'sent',
        finalized_at: toISODate(Temporal.Now.plainDateISO()),
        updated_at: toISODate(Temporal.Now.plainDateISO())
      });

    // Record audit log
    // await auditLog(
    //   trx,
    //   {
    //     userId: userId,
    //     operation: 'invoice_finalized',
    //     tableName: 'invoices',
    //     recordId: invoiceId,
    //     changedData: { finalized_at: toISODate(Temporal.Now.plainDateISO()) },
    //     details: {
    //       action: 'Invoice finalized',
    //       invoiceNumber: invoice.invoice_number
    //     }
    //   }
    // );
  });

  // Check if this is a prepayment invoice (no billing_cycle_id)
  if (invoice && !invoice.billing_cycle_id) {
    // For prepayment invoices, update the client's credit balance
    await ClientContractLine.updateClientCredit(invoice.client_id, invoice.subtotal);

    // Log the credit update
    console.log(`Updated credit balance for client ${invoice.client_id} by ${invoice.subtotal} from prepayment invoice ${invoiceId}`);
  }
  // Handle regular invoices with negative totals
  else if (invoice && invoice.total_amount < 0) {
    // Get absolute value of negative total
    const creditAmount = Math.abs(invoice.total_amount);

    // Update client credit balance and record transaction in a single transaction
    // We handle this directly without using ClientContractLine.updateClientCredit to avoid validation issues
    await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Get current credit balance
      const client = await trx('clients')
        .where({ client_id: invoice.client_id, tenant })
        .select('credit_balance')
        .first();

      if (!client) {
        throw new Error(`Client ${invoice.client_id} not found`);
      }

      // Get client's credit expiration settings or default settings
      const clientSettings = await trx('client_billing_settings')
        .where({
          client_id: invoice.client_id,
          tenant
        })
        .first();

      const defaultSettings = await trx('default_billing_settings')
        .where({ tenant })
        .first();

      // Determine expiration days - use client setting if available, otherwise use default
      let expirationDays: number | undefined;
      if (clientSettings?.credit_expiration_days != null) {
        expirationDays = clientSettings.credit_expiration_days;
      } else if (defaultSettings?.credit_expiration_days != null) {
        expirationDays = defaultSettings.credit_expiration_days;
      }

      // Calculate expiration date if applicable
      let expirationDate: string | undefined;
      if (expirationDays && expirationDays > 0) {
        const today = new Date();
        const expDate = new Date(today);
        expDate.setDate(today.getDate() + expirationDays);
        expirationDate = expDate.toISOString();
      }

      // Calculate new balance
      const newBalance = (client.credit_balance || 0) + creditAmount;

      // Update client credit balance within the transaction
      await trx('clients')
        .where({ client_id: invoice.client_id, tenant })
        .update({
          credit_balance: newBalance,
          updated_at: new Date().toISOString()
        });

      // Record transaction with the correct balance and expiration date
      // Skip validation for negative invoices since we're creating credit
      const transactionId = uuidv4();
      await trx('transactions').insert({
        transaction_id: transactionId,
        client_id: invoice.client_id,
        invoice_id: invoiceId,
        amount: creditAmount,
        type: 'credit_issuance_from_negative_invoice',
        status: 'completed',
        description: `Credit issued from negative invoice ${invoice.invoice_number}`,
        created_at: new Date().toISOString(),
        balance_after: newBalance,
        tenant,
        expiration_date: expirationDate
      });

      // Create credit tracking entry
      await trx('credit_tracking').insert({
        credit_id: uuidv4(),
        tenant,
        client_id: invoice.client_id,
        transaction_id: transactionId,
        amount: creditAmount,
        remaining_amount: creditAmount, // Initially, remaining amount equals the full amount
        created_at: new Date().toISOString(),
        expiration_date: expirationDate,
        is_expired: false,
        updated_at: new Date().toISOString()
      });

      // Log audit
      // await auditLog(
      //   trx,
      //   {
      //     userId: userId,
      //     operation: 'credit_issuance_from_negative_invoice',
      //     tableName: 'clients',
      //     recordId: invoice.client_id,
      //     changedData: {
      //       credit_balance: newBalance,
      //       expiration_date: expirationDate
      //     },
      //     details: {
      //       action: 'Credit issued from negative invoice',
      //       invoiceId: invoiceId,
      //       amount: creditAmount,
      //       expiration_date: expirationDate
      //     }
      //   }
      // );
    });

    // Log the credit update
    console.log(`Created credit of ${creditAmount} from negative invoice ${invoiceId} (${invoice.invoice_number})`);
  }
  // For regular invoices, check if there's available credit to apply
  else if (invoice && invoice.client_id) {
    const availableCredit = await ClientContractLine.getClientCredit(invoice.client_id);

    if (availableCredit > 0) {
      // Get the current invoice with updated totals
      const updatedInvoice = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await trx('invoices')
          .where({ invoice_id: invoiceId, tenant })
          .first();
      });

      if (updatedInvoice && updatedInvoice.total_amount > 0) {
        // Calculate how much credit to apply
        const creditToApply = Math.min(availableCredit, updatedInvoice.total_amount);

        if (creditToApply > 0) {
          // Apply credit to the invoice
          await applyCreditToInvoice(invoice.client_id, invoiceId, creditToApply);
        }
      }
    }
  }
}

export async function unfinalizeInvoice(invoiceId: string): Promise<void> {
  const { knex, tenant } = await createTenantKnex();
  const session = await getSession();

  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  if (!tenant) {
    throw new Error('No tenant found');
  }

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Check if invoice exists and is finalized
    const invoice = await trx('invoices')
      .where({ invoice_id: invoiceId })
      .first();

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    const normalizedStatus = invoice.status ? invoice.status.toLowerCase() : null;
    const isFinalized = Boolean(invoice.finalized_at) || (normalizedStatus && normalizedStatus !== 'draft');

    if (!isFinalized) {
      throw new Error('Invoice is not finalized');
    }

    // When unfinalizing make sure the invoice returns to draft status even if some
    // environments only toggle the status flag without storing finalized_at.
    const updatedFields: Record<string, unknown> = {
      finalized_at: null,
      updated_at: toISODate(Temporal.Now.plainDateISO())
    };

    if (normalizedStatus && normalizedStatus !== 'draft') {
      updatedFields.status = 'draft';
    }

    await trx('invoices')
      .where({
        invoice_id: invoiceId,
        tenant
      })
      .update(updatedFields);

    // Record audit log
    // await auditLog(
    //   trx,
    //   {
    //     userId: session.user.id,
    //     operation: 'invoice_unfinalized',
    //     tableName: 'invoices',
    //     recordId: invoiceId,
    //     changedData: { finalized_at: null },
    //     details: {
    //       action: 'Invoice unfinalized',
    //       invoiceNumber: invoice.invoice_number
    //     }
    //   }
    // );
  });
}

export async function updateInvoiceManualItems(
  invoiceId: string,
  changes: ManualItemsUpdate
): Promise<InvoiceViewModel> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }

  const session = await getSession();
  const billingEngine = new BillingEngine();

  console.log('[updateInvoiceManualItems] session:', session);

  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // Load and validate invoice
  const invoice = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('invoices')
      .where({ invoice_id: invoiceId })
      .first();
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  if (['paid', 'cancelled'].includes(invoice.status)) {
    throw new Error('Cannot modify a paid or cancelled invoice');
  }

  const client = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('clients')
      .where({ client_id: invoice.client_id })
      .first();
  });

  if (!client) {
    throw new Error('Client not found');
  }

  const currentDate = Temporal.Now.plainDateISO().toString();

  await updateManualInvoiceItemsInternal(invoiceId, changes, session, tenant); // Renamed internal call
  return await Invoice.getFullInvoiceById(knex, invoiceId);
}

// Internal helper function to avoid recursive export/import loop
async function updateManualInvoiceItemsInternal(
  invoiceId: string,
  changes: ManualItemsUpdate,
  session: Session,
  tenant: string
): Promise<void> {
  const { knex } = await createTenantKnex();
  const billingEngine = new BillingEngine();
  const currentDate = Temporal.Now.plainDateISO().toString();

  const invoice = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('invoices')
      .where({ invoice_id: invoiceId, tenant })
      .first();
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  if (['paid', 'cancelled'].includes(invoice.status)) {
    throw new Error('Cannot modify a paid or cancelled invoice');
  }

  const client = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('clients')
      .where({ client_id: invoice.client_id, tenant })
      .first();
  });

  if (!client) {
    throw new Error('Client not found');
  }

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Process removals
    if (changes.removedItemIds && changes.removedItemIds.length > 0) {
      await trx('invoice_charges')
        .whereIn('item_id', changes.removedItemIds)
        .andWhere({ tenant: tenant, is_manual: true }) // Ensure we only delete manual items intended for removal
        .delete();
    }

    // Process updates
    if (changes.updatedItems && changes.updatedItems.length > 0) {
      // First pass: Update all items with their new values
      for (const item of changes.updatedItems) {
        const updateData = {
          service_id: item.service_id,
          description: item.description,
          quantity: item.quantity,
          // Rate is already in cents from the frontend, no need to multiply by 100
          unit_price: item.rate !== undefined ? Math.round(item.rate) : undefined,
          is_discount: item.is_discount,
          discount_type: item.discount_type,
          discount_percentage: item.discount_percentage,
          applies_to_item_id: item.applies_to_item_id,
          is_taxable: item.is_taxable,
          updated_at: currentDate // Use the existing currentDate variable
        };
        // Filter out undefined values to avoid overwriting columns with null unnecessarily
        const filteredUpdateData = Object.fromEntries(Object.entries(updateData).filter(([_, v]) => v !== undefined));

        if (Object.keys(filteredUpdateData).length > 0) {
           await trx('invoice_charges')
            .where({ item_id: item.item_id, tenant: tenant, is_manual: true }) // Ensure we only update manual items
            .update(filteredUpdateData);
        }
      }
      
      // Second pass: Recalculate net_amount for discount items
      for (const item of changes.updatedItems) {
        if (item.is_discount) {
          // Get the updated item from the database
          const updatedItem = await trx('invoice_charges')
            .where({ item_id: item.item_id, tenant: tenant, is_manual: true })
            .first();
          
          if (updatedItem) {
            let applicableAmount;
            let subtotal = 0;
            
            // Calculate current subtotal of non-discount items for percentage discounts
            if (updatedItem.discount_type === 'percentage') {
              const nonDiscountItems = await trx('invoice_charges')
                .where({ invoice_id: invoiceId, tenant: tenant })
                .whereNot('is_discount', true)
                .select('*');
              
              subtotal = nonDiscountItems.reduce((sum, item) => sum + Number(item.net_amount), 0);
              
              // If discount applies to a specific item, get that item's amount
              if (updatedItem.applies_to_item_id) {
                const applicableItem = await trx('invoice_charges')
                  .where({ item_id: updatedItem.applies_to_item_id, tenant: tenant })
                  .first();
                applicableAmount = applicableItem?.net_amount;
              }
            }
            
            // Calculate new net_amount based on discount type
            let newNetAmount;
            if (updatedItem.discount_type === 'percentage' && updatedItem.discount_percentage !== null) {
              const baseAmount = updatedItem.applies_to_item_id
                ? (applicableAmount || 0)
                : subtotal;
              newNetAmount = -Math.round((baseAmount * updatedItem.discount_percentage) / 100);
            } else {
              // Fixed discount - use the unit_price
              newNetAmount = -Math.abs(Math.round(updatedItem.unit_price));
            }
            
            // Update the net_amount
            await trx('invoice_charges')
              .where({ item_id: item.item_id, tenant: tenant, is_manual: true })
              .update({
                net_amount: newNetAmount,
                total_price: newNetAmount // Also update total_price since discounts have no tax
              });
          }
        }
      }
    }

    // Add new items
    if (changes.newItems && changes.newItems.length > 0) {
      // Use persistManualInvoiceCharges for adding new manual items during update
      await persistManualInvoiceCharges(
        trx,
        invoiceId,
        changes.newItems.map(item => ({ // Ensure mapping matches ManualInvoiceItemInput
          item_id: item.item_id,
          rate: item.rate,
          quantity: item.quantity,
          is_discount: item.is_discount,
          discount_type: item.discount_type,
          applies_to_item_id: item.applies_to_item_id,
          service_id: item.service_id || undefined,
          description: item.description,
          tax_region: item.tax_region || client.tax_region,
          is_taxable: item.is_taxable !== false,
          applies_to_service_id: item.applies_to_service_id,
          discount_percentage: item.discount_percentage,
        })),
        client,
        session,
        tenant
        // No 'isManual' boolean needed for persistManualInvoiceCharges
      );
    }

    // Update invoice number if provided
    if (changes.invoice_number && changes.invoice_number !== invoice.invoice_number) {
      try {
        await trx('invoices')
          .where({ invoice_id: invoiceId, tenant })
          .update({
            invoice_number: changes.invoice_number,
            updated_at: currentDate
          });
      } catch (error: unknown) {
        if (error instanceof Error &&
          'code' in error &&
          error.code === '23505' &&
          'constraint' in error &&
          error.constraint === 'unique_invoice_number_per_tenant') {
          throw new Error('Invoice number must be unique');
        }
        throw error;
      }
    } else {
       // Touch updated_at even if only items changed
       await trx('invoices')
          .where({ invoice_id: invoiceId, tenant })
          .update({ updated_at: currentDate });
    }
  });

  // Recalculate totals after modifications
  await billingEngine.recalculateInvoice(invoiceId);

  // Emit INVOICE_UPDATED event after recalculation is complete
  try {
    // Re-fetch the updated invoice details to include in the payload
    const updatedInvoice = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('invoices')
        .where({ invoice_id: invoiceId, tenant })
        .first();
    });

    if (!updatedInvoice) {
      // This shouldn't happen if recalculate succeeded, but good to check
      console.error(`[updateManualInvoiceItemsInternal] Failed to fetch updated invoice ${invoiceId} for event emission.`);
      return; // Exit if invoice somehow disappeared
    }

    // Fetch realmId from qbo_credentials secret
    let realmId: string | null = null;
    try {
      const secretProvider = await getSecretProviderInstance();
      const secretString = await secretProvider.getTenantSecret(tenant, 'qbo_credentials'); // Read the whole secret

      if (secretString) {
        const allCredentials: Record<string, any> = JSON.parse(secretString); // Parse the multi-realm object

        // Find the first valid realmId
        for (const currentRealmId in allCredentials) {
          if (Object.prototype.hasOwnProperty.call(allCredentials, currentRealmId)) {
            const creds = allCredentials[currentRealmId];
            // Basic validation and check expiry
            if (creds && creds.accessToken && creds.accessTokenExpiresAt && new Date(creds.accessTokenExpiresAt) > new Date()) {
              realmId = currentRealmId; // Found a valid realm
              console.log(`[updateManualInvoiceItemsInternal] Found valid realmId in multi-realm secrets for tenant ${tenant}: ${realmId}`);
              break; // Use the first valid one found
            }
          }
        }
      }

      if (!realmId) {
         console.warn(`[updateManualInvoiceItemsInternal] No valid QBO realmId found in multi-realm secrets for tenant ${tenant}. realmId will be null for INVOICE_UPDATED event. This may cause issues in qboInvoiceSyncWorkflow.`);
      }

    } catch (error: any) {
      console.error(`[updateManualInvoiceItemsInternal] Error fetching/parsing multi-realm secrets for tenant ${tenant}:`, error.message);
      // realmId remains null.
    }

    const eventBus = getEventBus();
    const eventForBus = {
      eventType: 'INVOICE_UPDATED' as BusEventType, // Cast to ensure it's a valid EventType
      payload: {
        tenantId: tenant,
        userId: session.user.id,
        eventName: 'INVOICE_UPDATED', // This will be used by convertToWorkflowEvent
        // Original payload content:
        invoiceId: invoiceId,
        clientId: updatedInvoice.client_id,
        status: updatedInvoice.status,
        totalAmount: updatedInvoice.total_amount,
        invoiceNumber: updatedInvoice.invoice_number,
        realmId: realmId, // realmId for QBO sync
      }
    };
    console.log(`[updateManualInvoiceItemsInternal] Publishing INVOICE_UPDATED event for invoice ${invoiceId} in tenant ${tenant}. Event structure:`, JSON.stringify(eventForBus, null, 2)); // Added logging
    await eventBus.publish(eventForBus);
    console.log(`[updateManualInvoiceItemsInternal] Successfully published INVOICE_UPDATED event for invoice ${invoiceId} in tenant ${tenant}`);

  } catch (eventError) {
    console.error(`[updateManualInvoiceItemsInternal] Failed to enqueue INVOICE_UPDATED event for invoice ${invoiceId}:`, eventError);
    // Decide if this error should be propagated or just logged
  }
}


export async function addManualItemsToInvoice(
  invoiceId: string,
  items: IInvoiceCharge[]
): Promise<InvoiceViewModel> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }
  const session = await getSession();

  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // Load and validate invoice
  const invoice = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('invoices')
      .where({
        invoice_id: invoiceId,
        tenant
      })
      .first();
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  if (['paid', 'cancelled'].includes(invoice.status)) {
    throw new Error('Cannot modify a paid or cancelled invoice');
  }

  const client = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('clients')
      .where({
        client_id: invoice.client_id,
        tenant
      })
      .first();
  });

  if (!client) {
    throw new Error('Client not found');
  }

  await addManualInvoiceItemsInternal(invoiceId, items, session, tenant); // Renamed internal call
  return await Invoice.getFullInvoiceById(knex, invoiceId);
}

// Internal helper function
async function addManualInvoiceItemsInternal(
  invoiceId: string,
  items: IInvoiceCharge[],
  session: Session,
  tenant: string
): Promise<void> {
  const { knex } = await createTenantKnex();

  const invoice = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('invoices')
      .where({ invoice_id: invoiceId, tenant })
      .first();
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  if (['paid', 'cancelled'].includes(invoice.status)) {
    throw new Error('Cannot modify a paid or cancelled invoice');
  }

  const client = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('clients')
      .where({ client_id: invoice.client_id, tenant })
      .first();
  });

  if (!client) {
    throw new Error('Client not found');
  }

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Use persistManualInvoiceCharges for adding manual items
    await persistManualInvoiceCharges(
      trx,
      invoiceId,
      items.map(item => ({ // Ensure mapping matches ManualInvoiceItemInput
          item_id: item.item_id,
          rate: item.rate,
          quantity: item.quantity,
          is_discount: item.is_discount,
          discount_type: item.discount_type,
          applies_to_item_id: item.applies_to_item_id,
          service_id: item.service_id || undefined,
          description: item.description,
          tax_region: item.tax_region || client.tax_region,
          is_taxable: item.is_taxable !== false,
          applies_to_service_id: item.applies_to_service_id,
          discount_percentage: item.discount_percentage,
      })),
      client,
      session,
      tenant
      // No 'isManual' boolean needed for persistManualInvoiceCharges
    );
     // Touch updated_at when items are added
     await trx('invoices')
        .where({ invoice_id: invoiceId, tenant })
        .update({ updated_at: Temporal.Now.plainDateISO().toString() });
  });

  const billingEngine = new BillingEngine();
  await billingEngine.recalculateInvoice(invoiceId);
}


export async function hardDeleteInvoice(invoiceId: string) {
  const { knex, tenant } = await createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    // 1. Get invoice details
    const invoice = await trx('invoices')
      .where({
        invoice_id: invoiceId,
        tenant
      })
      .first();

    if (!invoice) {
        console.warn(`Invoice ${invoiceId} not found for deletion.`);
        return; // Exit if invoice doesn't exist
    }

    // 2. Handle payments
    const payments = await trx('transactions')
      .where({
        invoice_id: invoiceId,
        type: 'payment',
        tenant
      });

    if (payments.length > 0) {
      // Insert reversal transactions
      await trx('transactions').insert(
        payments.map((p): any => ({ // Use 'any' for flexibility, ensure required fields are present
          transaction_id: uuidv4(),
          client_id: p.client_id, // Ensure client_id is included
          invoice_id: p.invoice_id,
          amount: -p.amount,
          type: 'payment_reversal',
          status: 'completed', // Assuming reversal is completed
          description: `Reversal of payment ${p.transaction_id}`,
          created_at: new Date().toISOString(), // Use current time for reversal
          balance_after: null, // Balance needs recalculation or specific handling
          tenant: p.tenant,
          // Copy other relevant fields if necessary
        }))
      );
       // TODO: Recalculate client balance after reversals
    }

    // 3. Handle credit applied to this invoice
    if (invoice.credit_applied > 0) {
        // Find the credit application transaction
        const creditAppTransaction = await trx('transactions')
            .where({
                invoice_id: invoiceId,
                type: 'credit_application',
                tenant: tenant
            })
            .first();

        // Find related credit tracking entries that were used
        const creditTrackingUsed = await trx('credit_tracking_usage')
            .where({ transaction_id: creditAppTransaction?.transaction_id })
            .select('credit_id', 'amount_used');

        // Restore the used amounts back to the original credit_tracking entries
        for (const usage of creditTrackingUsed) {
            await trx('credit_tracking')
                .where({ credit_id: usage.credit_id })
                .increment('remaining_amount', usage.amount_used)
                .update({ updated_at: new Date().toISOString() }); // Update timestamp
        }

        // Delete the credit tracking usage records
        await trx('credit_tracking_usage')
            .where({ transaction_id: creditAppTransaction?.transaction_id })
            .delete();

        // Delete the credit application transaction itself
        await trx('transactions')
            .where({ transaction_id: creditAppTransaction?.transaction_id })
            .delete();

        // Update the client's credit balance
        await ClientContractLine.updateClientCredit(
            invoice.client_id,
            invoice.credit_applied // Add the credit back
        );
    }

    // Handle credit issued *from* this invoice (if it was negative)
    const creditIssuanceTransaction = await trx('transactions')
        .where({
            invoice_id: invoiceId,
            type: 'credit_issuance_from_negative_invoice',
            tenant: tenant
        })
        .first();

    if (creditIssuanceTransaction) {
        // Find the corresponding credit_tracking entry
        const creditTrackingEntry = await trx('credit_tracking')
            .where({ transaction_id: creditIssuanceTransaction.transaction_id })
            .first();

        if (creditTrackingEntry) {
            // Check if any of this credit was used
            const usageAmount = creditTrackingEntry.amount - creditTrackingEntry.remaining_amount;
            if (usageAmount > 0) {
                // This scenario is complex: credit issued by the invoice being deleted was already used.
                // Option 1: Throw error - prevent deletion if issued credit was used.
                // Option 2: Allow deletion but log a warning/create adjustment.
                // Option 3: Attempt to reverse the usage (very complex).
                throw new Error(`Cannot delete invoice ${invoiceId}: Credit issued by this invoice has already been used.`);
            } else {
                // Credit was issued but not used, safe to delete tracking and transaction
                await trx('credit_tracking')
                    .where({ credit_id: creditTrackingEntry.credit_id })
                    .delete();
                // Also update client balance back
                 await ClientContractLine.updateClientCredit(
                    invoice.client_id,
                    -creditTrackingEntry.amount // Subtract the credit that was issued
                );
            }
        }
        // Delete the credit issuance transaction
        await trx('transactions')
            .where({ transaction_id: creditIssuanceTransaction.transaction_id })
            .delete();
    }


    // 4. Unmark time entries
    await trx('time_entries')
      .whereIn('entry_id',
        trx('invoice_time_entries')
          .select('entry_id')
          .where({
            invoice_id: invoiceId,
            tenant
          })
      )
      .update({ invoiced: false });

    // 5. Unmark usage records
    await trx('usage_tracking')
      .whereIn('usage_id',
        trx('invoice_usage_records')
          .select('usage_id')
          .where({
            invoice_id: invoiceId,
            tenant
          })
      )
      .update({ invoiced: false });

    // 6. Delete other transactions related to the invoice (e.g., invoice_generated, price_adjustment)
    await trx('transactions')
      .where({
        invoice_id: invoiceId,
        tenant
      })
      // Exclude types already handled (payment, payment_reversal, credit_application, credit_issuance...)
      .whereNotIn('type', ['payment', 'payment_reversal', 'credit_application', 'credit_issuance_from_negative_invoice'])
      .delete();

    // 7. Delete join records
    await trx('invoice_time_entries')
      .where({
        invoice_id: invoiceId,
        tenant
      })
      .delete();

    await trx('invoice_usage_records')
      .where({
        invoice_id: invoiceId,
        tenant
      })
      .delete();

    // 8. Delete invoice items
    await trx('invoice_charges')
      .where({
        invoice_id: invoiceId,
        tenant
      })
      .delete();

    // 9. Delete invoice annotations (internal/external notes)
    await trx('invoice_annotations')
      .where({
        invoice_id: invoiceId,
        tenant
      })
      .delete();

    // 10. Delete invoice record
    await trx('invoices')
      .where({
        invoice_id: invoiceId,
        tenant
      })
      .delete();

     // TODO: Recalculate client balance after all deletions/reversals
  });
}
