'use server'

import { withTransaction } from '@shared/db';
import { createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex';
import { IClientContractLine } from '../../../interfaces/billing.interfaces';
import { Temporal } from '@js-temporal/polyfill';
import { toPlainDate, toISODate } from '../../utils/dateTimeUtils';
import { getSession } from 'server/src/lib/auth/getSession';
import { cloneTemplateContractLine } from '../../billing/utils/templateClone';

// Helper function to get the latest invoiced end date
async function getLatestInvoicedEndDate(db: any, tenant: string, clientContractLineId: string): Promise<Date | null> {
  // First, get the client_contract_id associated with the clientContractLineId
  const planInfo = await db('client_contract_lines')
    .select('client_id', 'contract_line_id', 'client_contract_id')
    .where({ client_contract_line_id: clientContractLineId, tenant: tenant })
    .first();

  if (!planInfo) {
    console.warn(`Client contract line ${clientContractLineId} not found for tenant ${tenant}`);
    return null; // No contract line assignment found
  }

  const { client_id, contract_line_id, client_contract_id } = planInfo;

  // Check for invoices with items linked to this specific client_contract via client_contract_id
  // This ensures we only check invoices generated from THIS specific contract assignment
  const latestInvoice = await db('invoices as i')
    .join('invoice_items as ii', function(this: Knex.JoinClause) {
      this.on('i.invoice_id', '=', 'ii.invoice_id')
          .andOn('i.tenant', '=', 'ii.tenant');
    })
    .join('client_contracts as cc', function(this: Knex.JoinClause) {
      this.on('ii.client_contract_id', '=', 'cc.client_contract_id')
          .andOn('ii.tenant', '=', 'cc.tenant');
    })
    .where({
      'cc.client_contract_id': client_contract_id,
      'cc.tenant': tenant
    })
    .orderBy('i.invoice_date', 'desc')
    .select('i.billing_period_end', 'i.invoice_date')
    .first();

  // If we found an invoice, determine the appropriate date to return
  if (latestInvoice) {
    // If billing_period_end exists, use it
    if (latestInvoice.billing_period_end) {
      return new Date(latestInvoice.billing_period_end);
    }
    // Otherwise, fall back to invoice_date
    else if (latestInvoice.invoice_date) {
      console.log(`Using invoice_date as fallback for plan ${contract_line_id} since billing_period_end is null`);
      return new Date(latestInvoice.invoice_date);
    }
  }

  // If no invoices found or no usable dates, return null
  return null;
}


export async function getClientContractLine(clientId: string): Promise<IClientContractLine[]> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const {knex: db, tenant} = await createTenantKnex();
    const clientContractLine = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('client_contract_lines')
        .where({ 
          client_id: clientId, 
          is_active: true,
          tenant 
        })
        .orderBy('start_date', 'desc');
    });

    return clientContractLine.map((billing: IClientContractLine): IClientContractLine => ({
      ...billing,
      // Convert dates to ISO8601String as expected by the interface
      // Convert dates to ISO8601String: DB -> PlainDate -> ISOString
      start_date: toISODate(toPlainDate(billing.start_date)),
      end_date: billing.end_date ? toISODate(toPlainDate(billing.end_date)) : null
    }));
  } catch (error) {
    console.error('Error fetching client contract line:', error);
    throw new Error('Failed to fetch client contract line');
  }
}

export async function updateClientContractLine(clientContractLineId: string, updates: Partial<IClientContractLine>): Promise<void> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const {knex: db, tenant} = await createTenantKnex();
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('client_contract_lines')
        .where({ 
          client_contract_line_id: clientContractLineId,
          tenant 
        })
        .update(updates);
    });

    if (result === 0) {
      throw new Error('Contract Line not found or no changes were made');
    }
  } catch (error) {
    console.error('Error updating client contract line:', error);
    throw new Error('Failed to update client contract line');
  }
}

export async function addClientContractLine(newBilling: Omit<IClientContractLine, 'client_contract_line_id' | 'tenant'>): Promise<void> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    // Build where clause based on provided fields
    const whereClause: any = {
      client_id: newBilling.client_id,
      contract_line_id: newBilling.contract_line_id,
      is_active: true,
      tenant
    };

    // Only include service_category if it's provided
    if (newBilling.service_category) {
      whereClause.service_category = newBilling.service_category;
    }

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const existingBilling = await trx('client_contract_lines')
        .where(whereClause)
        .whereNull('end_date')
        .first();

      if (existingBilling) {
        throw new Error('A contract line with the same details already exists for this client');
      }

      const templateContract = newBilling.client_contract_id
        ? await trx('client_contracts')
            .where({ tenant, client_contract_id: newBilling.client_contract_id })
            .first('template_contract_id', 'contract_id')
        : null;

      const templateContractId = templateContract?.template_contract_id ?? templateContract?.contract_id ?? null;

      // Only include service_category in insert if it's provided
      const insertData: Record<string, unknown> = {
        ...newBilling,
        tenant,
        // Convert string date to Date object if it's a string
        start_date: newBilling.start_date ? new Date(newBilling.start_date) : new Date(),
        // Handle end_date similarly if it exists
        end_date: newBilling.end_date ? new Date(newBilling.end_date) : null
      };
      
      if (!newBilling.service_category) {
        delete insertData.service_category;
      }

      insertData.template_contract_line_id = newBilling.contract_line_id;

      const [created] = await trx('client_contract_lines')
        .insert(insertData)
        .returning('client_contract_line_id');

      await cloneTemplateContractLine(trx, {
        tenant,
        templateContractLineId: newBilling.contract_line_id,
        clientContractLineId: created.client_contract_line_id,
        templateContractId,
        overrideRate: newBilling.custom_rate ?? null,
        effectiveDate: insertData.start_date instanceof Date ? insertData.start_date.toISOString() : null
      });

      return created;
    });
  } catch (error: any) {
    console.error('Error adding client contract line:', error);
    // Provide more specific error message
    if (error.code === 'ER_NO_SUCH_TABLE') {
      throw new Error('Database table not found');
    } else if (error.code === 'ER_BAD_FIELD_ERROR') {
      throw new Error('Invalid database field');
    } else {
      throw new Error(error.message || 'Failed to add client contract line');
    }
  }
}

export async function removeClientContractLine(clientContractLineId: string): Promise<void> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const {knex: db, tenant} = await createTenantKnex();

    // Ensure tenant context exists before proceeding
    if (!tenant) {
      throw new Error('Tenant context is missing. Cannot perform validation.');
    }

    // --- Validation Start ---
    const latestInvoicedEndDate = await getLatestInvoicedEndDate(db, tenant, clientContractLineId);
    const now = new Date();

    if (latestInvoicedEndDate) {
        // Convert to PlainDate for reliable comparison
        const latestInvoicedPlainDate = toPlainDate(latestInvoicedEndDate);
        const nowPlainDate = toPlainDate(now);

        if (Temporal.PlainDate.compare(nowPlainDate, latestInvoicedPlainDate) < 0) {
            throw new Error(
                `Cannot deactivate contract line assignment before ${latestInvoicedPlainDate.toLocaleString()} as it has been invoiced through that date. The earliest end date allowed is ${latestInvoicedPlainDate.toLocaleString()}.`
            );
        }
    }
    // --- Validation End ---

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('client_contract_lines')
        .where({
          client_contract_line_id: clientContractLineId,
          tenant
        })
        .update({ is_active: false, end_date: now }); // Use the 'now' variable
    });

    if (result === 0) {
      throw new Error('Contract Line not found or already inactive');
    }
  } catch (error: any) {
    console.error('Error removing client contract line:', error);
    // Preserve the original error message if it exists
    throw new Error(error.message || 'Failed to remove client contract line');
  }
}

export async function editClientContractLine(clientContractLineId: string, updates: Partial<IClientContractLine>): Promise<void> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const {knex: db, tenant} = await createTenantKnex();
    
    // Convert dates to proper format
    // Use 'any' type here to allow assigning Date objects, knex will handle them.
    const updateData: any = { ...updates };

    // Convert string dates to Date objects if they exist
    if (updates.start_date) {
        updateData.start_date = new Date(updates.start_date);
    }
    // Ensure end_date is null if not provided or empty, otherwise convert to Date
    updateData.end_date = updates.end_date ? new Date(updates.end_date) : null;

    // Ensure service_category is null for the DB if it's undefined or an empty string
    if (updates.service_category === undefined || updates.service_category === '') {
        updateData.service_category = null;
    } else {
        // Keep the valid UUID string if provided
        updateData.service_category = updates.service_category;
    }

    // Ensure tenant context exists before proceeding
    if (!tenant) {
      throw new Error('Tenant context is missing. Cannot perform validation.');
    }

    // --- Validation Start ---
    const latestInvoicedEndDate = await getLatestInvoicedEndDate(db, tenant, clientContractLineId);

    if (latestInvoicedEndDate) {
        const latestInvoicedPlainDate = toPlainDate(latestInvoicedEndDate);
        const proposedEndDate = updateData.end_date ? toPlainDate(updateData.end_date) : null;
        const proposedIsActive = updateData.is_active; // Could be true, false, or undefined (if not changing)
        const nowPlainDate = toPlainDate(new Date()); // Needed if setting is_active to false

        // Check if trying to set inactive before the latest invoice date
        // Note: Deactivating implicitly sets end_date to now if not provided.
        // If an end_date IS provided along with is_active=false, the end_date check below handles it.
        if (proposedIsActive === false && !proposedEndDate && Temporal.PlainDate.compare(nowPlainDate, latestInvoicedPlainDate) < 0) {
             throw new Error(
                `Cannot deactivate contract line assignment before ${latestInvoicedPlainDate.toLocaleString()} as it has been invoiced through that date.`
              );
        }

        // Check if trying to set an end date before the latest invoice date
        if (proposedEndDate && Temporal.PlainDate.compare(proposedEndDate, latestInvoicedPlainDate) < 0) {
            throw new Error(
            `Cannot set end date to ${proposedEndDate.toLocaleString()} as the contract line has been invoiced through ${latestInvoicedPlainDate.toLocaleString()}. The earliest end date allowed is ${latestInvoicedPlainDate.toLocaleString()}.`
            );
        }
    }
    // --- Validation End ---

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('client_contract_lines')
        .where({
          client_contract_line_id: clientContractLineId,
          tenant
        })
        .update(updateData);
    });

    if (result === 0) {
      throw new Error('Contract Line not found or no changes were made');
    }
  } catch (error: any) {
    console.error('Error editing client contract line:', error);
    // Preserve the original error message if it exists
    throw new Error(error.message || 'Failed to edit client contract line');
  }
}
