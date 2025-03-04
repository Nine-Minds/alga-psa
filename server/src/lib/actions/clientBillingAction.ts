'use server'

import CompanyBillingPlan from 'server/src/lib/models/clientBilling';
import { ICompanyBillingPlan } from 'server/src/interfaces/billing.interfaces';

export async function createClientBilling(
  billingData: Omit<ICompanyBillingPlan, 'company_billing_plan_id'>
): Promise<ICompanyBillingPlan> {
  try {
    if (!billingData.service_category) {
      throw new Error('Service category is required for billing plans');
    }

    // Check for overlapping billing entries
    const overlappingBillings = await CompanyBillingPlan.checkOverlappingBilling(
      billingData.company_id,
      billingData.service_category,
      new Date(billingData.start_date),
      new Date(billingData.end_date!),
    );

    if (overlappingBillings.length > 0) {
      const conflictingBilling = overlappingBillings[0];
      throw new Error(`Cannot create billing plan: overlapping billing plan exists for company ${billingData.company_id} and service category "${billingData.service_category}". Conflicting entry: ID ${conflictingBilling.company_billing_plan_id}, Start Date: ${conflictingBilling.start_date.slice(0, 10)}, End Date: ${conflictingBilling.end_date ? conflictingBilling.end_date.slice(0, 10) : 'Ongoing'}`);
    }

    // If no overlapping entries, create the new billing
    const newBilling = await CompanyBillingPlan.create(billingData);
    return newBilling;
  } catch (error) {
    console.error('Error creating client billing:', error);
    throw error;
  }
}

export async function updateClientBilling(
  billingId: string,
  billingData: Partial<ICompanyBillingPlan>
): Promise<ICompanyBillingPlan> {
  try {
    const existingBilling = await CompanyBillingPlan.getById(billingId);
    if (!existingBilling) {
      throw new Error(`Billing entry with ID ${billingId} not found`);
    }

    // Check for overlapping billing entries, excluding the current one
    const overlappingBillings = await CompanyBillingPlan.checkOverlappingBilling(
      existingBilling.company_id,
      existingBilling.service_category || '',
      new Date(billingData.start_date || existingBilling.start_date),
      new Date(billingData.end_date! || existingBilling.end_date!),
      billingId
    );

    if (overlappingBillings.length > 0) {
      const conflictingBilling = overlappingBillings[0];
      throw new Error(`Cannot update billing plan: overlapping billing plan exists for company ${existingBilling.company_id} and service category "${existingBilling.service_category}". Conflicting entry: ID ${conflictingBilling.company_billing_plan_id}, Start Date: ${conflictingBilling.start_date.slice(0, 10)}, End Date: ${conflictingBilling.end_date?.slice(0, 10) || 'Ongoing'}`);
    }

    // If no overlapping entries, update the billing
    const updatedBilling = await CompanyBillingPlan.update(billingId, billingData);
    return updatedBilling;
  } catch (error) {
    console.error('Error updating client billing:', error);
    throw error;
  }
}

export async function getClientBilling(companyId: string): Promise<ICompanyBillingPlan[]> {
  try {
    const billings = await CompanyBillingPlan.getByCompanyId(companyId);
    return billings;
  } catch (error) {
    console.error('Error fetching client billing:', error);
    throw new Error('Failed to fetch company billing plans');
  }
}

export async function getOverlappingBillings(
  companyId: string,
  serviceCategory: string,
  startDate: Date,
  endDate: Date | null,
  excludeBillingId?: string
): Promise<ICompanyBillingPlan[]> {
  try {
    const overlappingBillings = await CompanyBillingPlan.checkOverlappingBilling(
      companyId,
      serviceCategory,
      startDate,
      endDate,
      excludeBillingId
    );
    return overlappingBillings;
  } catch (error) {
    console.error('Error checking for overlapping billings:', error);
    throw new Error('Failed to check for overlapping billing plans');
  }
}