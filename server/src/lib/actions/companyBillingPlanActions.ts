'use server'

import { createTenantKnex } from '../db';
import { getServerSession } from "next-auth/next";
import { options } from "../../app/api/auth/[...nextauth]/options";
import { ICompanyBillingPlan } from '../../interfaces/billing.interfaces';

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

    return companyBillingPlan.map((billing): ICompanyBillingPlan => ({
      ...billing,
      start_date: new Date(billing.start_date),
      end_date: billing.end_date ? new Date(billing.end_date) : null
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
    const insertData = { ...newBilling, tenant };
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
    const result = await db('company_billing_plans')
      .where({ 
        company_billing_plan_id: companyBillingPlanId,
        tenant 
      })
      .update({ is_active: false, end_date: new Date() });

    if (result === 0) {
      throw new Error('Billing plan not found or already inactive');
    }
  } catch (error) {
    console.error('Error removing company billing plan:', error);
    throw new Error('Failed to remove company billing plan');
  }
}

export async function editCompanyBillingPlan(companyBillingPlanId: string, updates: Partial<ICompanyBillingPlan>): Promise<void> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const {knex: db, tenant} = await createTenantKnex();
    const updateData: any = { ...updates };

    // Assuming start_date and end_date are already in the correct format (ISO string)
    // If they need to be converted, you would do that here

    const result = await db('company_billing_plans')
      .where({ 
        company_billing_plan_id: companyBillingPlanId,
        tenant 
      })
      .update(updateData);

    if (result === 0) {
      throw new Error('Billing plan not found or no changes were made');
    }
  } catch (error) {
    console.error('Error editing company billing plan:', error);
    throw new Error('Failed to edit company billing plan');
  }
}
