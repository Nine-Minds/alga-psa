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
  const planInfo = await db('contract_lines as cl')
    .join('client_contracts as cc', function(this: Knex.JoinClause) {
      this.on('cl.contract_id', '=', 'cc.contract_id')
          .andOn('cl.tenant', '=', 'cc.tenant');
    })
    .select('cc.client_id', 'cl.contract_line_id', 'cc.client_contract_id')
    .where({ 'cl.contract_line_id': clientContractLineId, 'cl.tenant': tenant })
    .first();

  if (!planInfo) {
    console.warn(`Contract line ${clientContractLineId} not found for tenant ${tenant}`);
    return null; // No contract line assignment found
  }

  const { client_id, contract_line_id, client_contract_id } = planInfo;

  // Check for invoices with items linked to this specific client_contract via client_contract_id
  // This ensures we only check invoices generated from THIS specific contract assignment
  const latestInvoice = await db('invoices as i')
    .join('invoice_charges as ii', function(this: Knex.JoinClause) {
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
      return await trx('contract_lines as cl')
        .join('client_contracts as cc', function () {
          this.on('cc.contract_id', '=', 'cl.contract_id')
            .andOn('cc.tenant', '=', 'cl.tenant');
        })
        .join('contracts as co', function () {
          this.on('co.contract_id', '=', 'cl.contract_id')
            .andOn('co.tenant', '=', 'cl.tenant');
        })
        .leftJoin('service_categories as sc', function () {
          this.on('sc.category_id', '=', 'cl.service_category')
            .andOn('sc.tenant', '=', 'cl.tenant');
        })
        .where({ 
          'cc.client_id': clientId, 
          'cl.is_active': true,
          'cl.tenant': tenant 
        })
        .select([
          'cl.*',
          'cl.contract_line_id as client_contract_line_id', // Map to expected interface field
          'cc.client_id',
          'cc.client_contract_id',
          'cc.start_date',
          'cc.end_date',
          'cc.template_contract_id',
          'co.contract_name',
          'sc.category_name as service_category_name'
        ])
        .orderBy('cc.start_date', 'desc');
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
      // Filter updates to include only columns that exist on contract_lines
      const {
        client_contract_line_id,
        client_id,
        start_date,
        end_date,
        client_contract_id,
        template_contract_id,
        contract_name,
        service_category_name,
        ...validUpdates
      } = updates as any;

      return await trx('contract_lines')
        .where({ 
          contract_line_id: clientContractLineId,
          tenant 
        })
        .update(validUpdates);
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

    await withTransaction(db, async (trx: Knex.Transaction) => {
      // Get the client contract to find the target contract_id
      if (!newBilling.client_contract_id) {
        throw new Error('client_contract_id is required');
      }

      const clientContract = await trx('client_contracts')
        .where({ tenant, client_contract_id: newBilling.client_contract_id })
        .first('template_contract_id', 'contract_id');

      if (!clientContract?.contract_id) {
        throw new Error('Client contract not found or missing contract_id');
      }

      const templateContractId = clientContract.template_contract_id ?? clientContract.contract_id;

      // Get the template line to copy
      const templateLine = await trx('contract_lines')
        .where({ tenant, contract_line_id: newBilling.contract_line_id })
        .first();

      if (!templateLine) {
        throw new Error(`Template contract line ${newBilling.contract_line_id} not found`);
      }

      // Check if this contract already has a line from the same template
      const existingLine = await trx('contract_lines')
        .where({
          tenant,
          contract_id: clientContract.contract_id,
          is_active: true
        })
        .whereRaw('contract_line_name = ?', [templateLine.contract_line_name])
        .first();

      if (existingLine) {
        throw new Error('A contract line with the same details already exists for this client');
      }

      // Create new contract_line for the client's contract
      const newContractLineId = trx.raw('gen_random_uuid()');
      const startDate = newBilling.start_date ? new Date(newBilling.start_date) : new Date();

      const [created] = await trx('contract_lines')
        .insert({
          contract_line_id: newContractLineId,
          tenant,
          contract_id: clientContract.contract_id,
          contract_line_name: templateLine.contract_line_name,
          description: templateLine.description,
          billing_frequency: templateLine.billing_frequency,
          contract_line_type: templateLine.contract_line_type,
          service_category: newBilling.service_category ?? templateLine.service_category,
          billing_timing: templateLine.billing_timing ?? 'arrears',
          is_active: newBilling.is_active ?? true,
          is_custom: false,
          custom_rate: newBilling.custom_rate ?? templateLine.custom_rate,
          display_order: templateLine.display_order ?? 0,
          enable_proration: templateLine.enable_proration,
          enable_overtime: templateLine.enable_overtime,
          overtime_rate: templateLine.overtime_rate,
          overtime_threshold: templateLine.overtime_threshold,
          enable_after_hours_rate: templateLine.enable_after_hours_rate,
          after_hours_multiplier: templateLine.after_hours_multiplier,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now()
        })
        .returning('contract_line_id');

      await cloneTemplateContractLine(trx, {
        tenant,
        templateContractLineId: newBilling.contract_line_id,
        contractLineId: created.contract_line_id,
        templateContractId,
        overrideRate: newBilling.custom_rate ?? null,
        effectiveDate: startDate.toISOString()
      });

      return created;
    });
  } catch (error: any) {
    console.error('Error adding client contract line:', error);
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
      return await trx('contract_lines')
        .where({
          contract_line_id: clientContractLineId,
          tenant
        })
        .update({ is_active: false }); // end_date removed as it's not on contract_lines
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
      // Filter updates to include only columns that exist on contract_lines
      const {
        client_contract_line_id,
        client_id,
        start_date,
        end_date,
        client_contract_id,
        template_contract_id,
        contract_name,
        service_category_name,
        ...validUpdates
      } = updateData as any;

      return await trx('contract_lines')
        .where({
          contract_line_id: clientContractLineId,
          tenant
        })
        .update(validUpdates);
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
