'use server'

import { createTenantKnex } from '../db';
import { Knex } from 'knex'; // Import Knex type
import { getServerSession } from "next-auth/next";
import { options } from "../../app/api/auth/[...nextauth]/options";
import { ICompanyBillingPlan } from '../../interfaces/billing.interfaces';
import { Temporal } from '@js-temporal/polyfill'; // Needed for date comparisons
import { toPlainDate, toISODate } from '../utils/dateTimeUtils'; // Use centralized date utilities

// Helper function to get the latest invoiced end date
async function getLatestInvoicedEndDate(db: any, tenant: string, companyBillingPlanId: string): Promise<Date | null> {
  // First, get the company_id and plan_id associated with the companyBillingPlanId
  const planInfo = await db('company_billing_plans')
    .select('company_id', 'plan_id')
    .where({ company_billing_plan_id: companyBillingPlanId, tenant: tenant })
    .first();

  if (!planInfo) {
    console.warn(`Company billing plan ${companyBillingPlanId} not found for tenant ${tenant}`);
    return null; // No plan assignment found
  }

  const { company_id, plan_id } = planInfo;

  // We need to check two types of invoices:
  // 1. Invoices with items linked to this plan through plan_services (traditional path)
  // 2. Invoices with items linked to this plan through invoice_item_details and plan_service_configuration (fixed fee path)

  // Query 1: Check for invoices linked through plan_services (traditional path)
  const traditionalPathQuery = db('invoices as i')
    .join('invoice_items as ii', function(this: Knex.JoinClause) {
      this.on('i.invoice_id', '=', 'ii.invoice_id')
          .andOn('i.tenant', '=', 'ii.tenant');
    })
    .join('plan_services as ps', function(this: Knex.JoinClause) {
      this.on('ii.service_id', '=', 'ps.service_id')
          .andOn('ii.tenant', '=', 'ps.tenant');
    })
    .where({
      'i.company_id': company_id,
      'ps.plan_id': plan_id,
      'i.tenant': tenant
    })
    .orderBy('i.invoice_date', 'desc')
    .select('i.billing_period_end', 'i.invoice_date')
    .first();

  // Query 2: Check for invoices linked through invoice_item_details and plan_service_configuration (fixed fee path)
  const fixedFeePathQuery = db('invoices as i')
    .join('invoice_items as ii', function(this: Knex.JoinClause) {
      this.on('i.invoice_id', '=', 'ii.invoice_id')
          .andOn('i.tenant', '=', 'ii.tenant');
    })
    .join('invoice_item_details as iid', function(this: Knex.JoinClause) {
      this.on('ii.item_id', '=', 'iid.item_id')
          .andOn('ii.tenant', '=', 'iid.tenant');
    })
    .join('plan_service_configuration as psc', function(this: Knex.JoinClause) {
      this.on('iid.config_id', '=', 'psc.config_id')
          .andOn('iid.tenant', '=', 'psc.tenant');
    })
    .where({
      'i.company_id': company_id,
      'psc.plan_id': plan_id,
      'i.tenant': tenant
    })
    .orderBy('i.invoice_date', 'desc')
    .select('i.billing_period_end', 'i.invoice_date')
    .first();

  // Execute both queries in parallel
  const [traditionalPathInvoice, fixedFeePathInvoice] = await Promise.all([
    traditionalPathQuery,
    fixedFeePathQuery
  ]);

  // Determine which invoice is more recent (if both exist)
  let latestInvoice = null;
  if (traditionalPathInvoice && fixedFeePathInvoice) {
    const traditionalDate = new Date(traditionalPathInvoice.invoice_date);
    const fixedFeeDate = new Date(fixedFeePathInvoice.invoice_date);
    latestInvoice = traditionalDate >= fixedFeeDate ? traditionalPathInvoice : fixedFeePathInvoice;
  } else {
    latestInvoice = traditionalPathInvoice || fixedFeePathInvoice;
  }

  // If we found an invoice, determine the appropriate date to return
  if (latestInvoice) {
    // If billing_period_end exists, use it
    if (latestInvoice.billing_period_end) {
      return new Date(latestInvoice.billing_period_end);
    }
    // Otherwise, fall back to invoice_date
    else if (latestInvoice.invoice_date) {
      console.log(`Using invoice_date as fallback for plan ${plan_id} since billing_period_end is null`);
      return new Date(latestInvoice.invoice_date);
    }
  }

  // If no invoices found or no usable dates, return null
  return null;
}


export async function getCompanyBillingPlan(companyId: string): Promise<ICompanyBillingPlan[]> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const {knex: db, tenant} = await createTenantKnex();
    const companyBillingPlan = await db('company_billing_plans')
      .where({ 
        company_id: companyId, 
        is_active: true,
        tenant 
      })
      .orderBy('start_date', 'desc');

    return companyBillingPlan.map((billing: ICompanyBillingPlan): ICompanyBillingPlan => ({
      ...billing,
      // Convert dates to ISO8601String as expected by the interface
      // Convert dates to ISO8601String: DB -> PlainDate -> ISOString
      start_date: toISODate(toPlainDate(billing.start_date)),
      end_date: billing.end_date ? toISODate(toPlainDate(billing.end_date)) : null
    }));
  } catch (error) {
    console.error('Error fetching company billing plan:', error);
    throw new Error('Failed to fetch company billing plan');
  }
}

export async function updateCompanyBillingPlan(companyBillingPlanId: string, updates: Partial<ICompanyBillingPlan>): Promise<void> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const {knex: db, tenant} = await createTenantKnex();
    const result = await db('company_billing_plans')
      .where({ 
        company_billing_plan_id: companyBillingPlanId,
        tenant 
      })
      .update(updates);

    if (result === 0) {
      throw new Error('Billing plan not found or no changes were made');
    }
  } catch (error) {
    console.error('Error updating company billing plan:', error);
    throw new Error('Failed to update company billing plan');
  }
}

export async function addCompanyBillingPlan(newBilling: Omit<ICompanyBillingPlan, 'company_billing_plan_id' | 'tenant'>): Promise<void> {
  const session = await getServerSession(options);
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
      company_id: newBilling.company_id,
      plan_id: newBilling.plan_id,
      is_active: true,
      tenant
    };

    // Only include service_category if it's provided
    if (newBilling.service_category) {
      whereClause.service_category = newBilling.service_category;
    }

    const existingBilling = await db('company_billing_plans')
      .where(whereClause)
      .whereNull('end_date')
      .first();

    if (existingBilling) {
      throw new Error('A billing plan with the same details already exists for this company');
    }

    // Only include service_category in insert if it's provided
    const insertData = {
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

    await db('company_billing_plans').insert(insertData);
  } catch (error: any) {
    console.error('Error adding company billing plan:', error);
    // Provide more specific error message
    if (error.code === 'ER_NO_SUCH_TABLE') {
      throw new Error('Database table not found');
    } else if (error.code === 'ER_BAD_FIELD_ERROR') {
      throw new Error('Invalid database field');
    } else {
      throw new Error(error.message || 'Failed to add company billing plan');
    }
  }
}

export async function removeCompanyBillingPlan(companyBillingPlanId: string): Promise<void> {
  const session = await getServerSession(options);
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
    const latestInvoicedEndDate = await getLatestInvoicedEndDate(db, tenant, companyBillingPlanId);
    const now = new Date();

    if (latestInvoicedEndDate) {
        // Convert to PlainDate for reliable comparison
        const latestInvoicedPlainDate = toPlainDate(latestInvoicedEndDate);
        const nowPlainDate = toPlainDate(now);

        if (Temporal.PlainDate.compare(nowPlainDate, latestInvoicedPlainDate) < 0) {
            throw new Error(
                `Cannot deactivate plan assignment before ${latestInvoicedPlainDate.toLocaleString()} as it has been invoiced through that date. The earliest end date allowed is ${latestInvoicedPlainDate.toLocaleString()}.`
            );
        }
    }
    // --- Validation End ---

    const result = await db('company_billing_plans')
      .where({
        company_billing_plan_id: companyBillingPlanId,
        tenant
      })
      .update({ is_active: false, end_date: now }); // Use the 'now' variable

    if (result === 0) {
      throw new Error('Billing plan not found or already inactive');
    }
  } catch (error: any) {
    console.error('Error removing company billing plan:', error);
    // Preserve the original error message if it exists
    throw new Error(error.message || 'Failed to remove company billing plan');
  }
}

export async function editCompanyBillingPlan(companyBillingPlanId: string, updates: Partial<ICompanyBillingPlan>): Promise<void> {
  const session = await getServerSession(options);
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
    const latestInvoicedEndDate = await getLatestInvoicedEndDate(db, tenant, companyBillingPlanId);

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
                `Cannot deactivate plan assignment before ${latestInvoicedPlainDate.toLocaleString()} as it has been invoiced through that date.`
              );
        }

        // Check if trying to set an end date before the latest invoice date
        if (proposedEndDate && Temporal.PlainDate.compare(proposedEndDate, latestInvoicedPlainDate) < 0) {
            throw new Error(
            `Cannot set end date to ${proposedEndDate.toLocaleString()} as the plan has been invoiced through ${latestInvoicedPlainDate.toLocaleString()}. The earliest end date allowed is ${latestInvoicedPlainDate.toLocaleString()}.`
            );
        }
    }
    // --- Validation End ---

    const result = await db('company_billing_plans')
      .where({
        company_billing_plan_id: companyBillingPlanId,
        tenant
      })
      .update(updateData);

    if (result === 0) {
      throw new Error('Billing plan not found or no changes were made');
    }
  } catch (error: any) {
    console.error('Error editing company billing plan:', error);
    // Preserve the original error message if it exists
    throw new Error(error.message || 'Failed to edit company billing plan');
  }
}
