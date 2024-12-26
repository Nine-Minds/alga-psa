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
    const {knex: db} = await createTenantKnex();
    const companyBillingPlan = await db('company_billing_plans')
      .where({ company_id: companyId, is_active: true })
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
    const {knex: db} = await createTenantKnex();
    const result = await db('company_billing_plans')
      .where({ company_billing_plan_id: companyBillingPlanId })
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
    const existingBilling = await db('company_billing_plans')
      .where({
        company_id: newBilling.company_id,
        plan_id: newBilling.plan_id,
        service_category: newBilling.service_category,
        is_active: true
      })
      .whereNull('end_date')
      .first();

    if (existingBilling) {
      throw new Error('A billing plan with the same details already exists for this company');
    }

    await db('company_billing_plans').insert({...newBilling, tenant});
  } catch (error: any) {
    console.error('Error adding company billing plan:', error);
    throw new Error(error);
  }
}

export async function removeCompanyBillingPlan(companyBillingPlanId: string): Promise<void> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const {knex: db} = await createTenantKnex();
    const result = await db('company_billing_plans')
      .where({ company_billing_plan_id: companyBillingPlanId })
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
    const {knex: db} = await createTenantKnex();
    const updateData: any = { ...updates };

    // Assuming start_date and end_date are already in the correct format (ISO string)
    // If they need to be converted, you would do that here

    const result = await db('company_billing_plans')
      .where({ company_billing_plan_id: companyBillingPlanId })
      .update(updateData);

    if (result === 0) {
      throw new Error('Billing plan not found or no changes were made');
    }
  } catch (error) {
    console.error('Error editing company billing plan:', error);
    throw new Error('Failed to edit company billing plan');
  }
}
