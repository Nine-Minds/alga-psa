'use server'

import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';
import ClientBillingPlan from 'server/src/lib/models/clientBilling';
import { IClientBillingPlan } from 'server/src/interfaces/billing.interfaces';

export async function createClientBilling(
  billingData: Omit<IClientBillingPlan, 'client_billing_plan_id'>
): Promise<IClientBillingPlan> {
  try {
    if (!billingData.service_category) {
      throw new Error('Service category is required for billing plans');
    }

    // Check for overlapping billing entries
    const overlappingBillings = await ClientBillingPlan.checkOverlappingBilling(
      billingData.client_id,
      billingData.service_category,
      new Date(billingData.start_date),
      new Date(billingData.end_date!),
    );

    if (overlappingBillings.length > 0) {
      const conflictingBilling = overlappingBillings[0];
      throw new Error(`Cannot create billing plan: overlapping billing plan exists for client ${billingData.client_id} and service category "${billingData.service_category}". Conflicting entry: ID ${conflictingBilling.client_billing_plan_id}, Start Date: ${conflictingBilling.start_date.slice(0, 10)}, End Date: ${conflictingBilling.end_date ? conflictingBilling.end_date.slice(0, 10) : 'Ongoing'}`);
    }

    // If no overlapping entries, create the new billing
    const newBilling = await ClientBillingPlan.create(billingData);
    return newBilling;
  } catch (error) {
    console.error('Error creating client billing:', error);
    throw error;
  }
}

export async function updateClientBilling(
  billingId: string,
  billingData: Partial<IClientBillingPlan>
): Promise<IClientBillingPlan> {
  try {
    const existingBilling = await ClientBillingPlan.getById(billingId);
    if (!existingBilling) {
      throw new Error(`Billing entry with ID ${billingId} not found`);
    }

    // Check for overlapping billing entries, excluding the current one
    const overlappingBillings = await ClientBillingPlan.checkOverlappingBilling(
      existingBilling.client_id,
      existingBilling.service_category || '',
      new Date(billingData.start_date || existingBilling.start_date),
      new Date(billingData.end_date! || existingBilling.end_date!),
      billingId
    );

    if (overlappingBillings.length > 0) {
      const conflictingBilling = overlappingBillings[0];
      throw new Error(`Cannot update billing plan: overlapping billing plan exists for client ${existingBilling.client_id} and service category "${existingBilling.service_category}". Conflicting entry: ID ${conflictingBilling.client_billing_plan_id}, Start Date: ${conflictingBilling.start_date.slice(0, 10)}, End Date: ${conflictingBilling.end_date?.slice(0, 10) || 'Ongoing'}`);
    }

    // If no overlapping entries, update the billing
    const updatedBilling = await ClientBillingPlan.update(billingId, billingData);
    return updatedBilling;
  } catch (error) {
    console.error('Error updating client billing:', error);
    throw error;
  }
}

export async function getClientBilling(clientId: string): Promise<IClientBillingPlan[]> {
  try {
    const billings = await ClientBillingPlan.getByClientId(clientId);
    return billings;
  } catch (error) {
    console.error('Error fetching client billing:', error);
    throw new Error('Failed to fetch client billing plans');
  }
}

export async function getOverlappingBillings(
  clientId: string,
  serviceCategory: string,
  startDate: Date,
  endDate: Date | null,
  excludeBillingId?: string
): Promise<IClientBillingPlan[]> {
  try {
    const overlappingBillings = await ClientBillingPlan.checkOverlappingBilling(
      clientId,
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