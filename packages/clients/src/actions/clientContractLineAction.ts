'use server'

import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import ClientContractLine from '../models/clientContractLine';
import { IClientContractLine } from '@alga-psa/types';

export async function createClientContractLine(
  billingData: Omit<IClientContractLine, 'client_contract_line_id'>
): Promise<IClientContractLine> {
  try {
    if (!billingData.service_category) {
      throw new Error('Service category is required for contract lines');
    }

    // Check for overlapping billing entries
    const overlappingBillings = await ClientContractLine.checkOverlappingBilling(
      billingData.client_id,
      billingData.service_category,
      new Date(billingData.start_date),
      new Date(billingData.end_date!),
    );

    if (overlappingBillings.length > 0) {
      const conflictingBilling = overlappingBillings[0];
      throw new Error(`Cannot create contract line: overlapping contract line exists for client ${billingData.client_id} and service category "${billingData.service_category}". Conflicting entry: ID ${conflictingBilling.client_contract_line_id}, Start Date: ${conflictingBilling.start_date.slice(0, 10)}, End Date: ${conflictingBilling.end_date ? conflictingBilling.end_date.slice(0, 10) : 'Ongoing'}`);
    }

    // If no overlapping entries, create the new billing
    const newBilling = await ClientContractLine.create(billingData);
    return newBilling;
  } catch (error) {
    console.error('Error creating client billing:', error);
    throw error;
  }
}

export async function updateClientContractLine(
  billingId: string,
  billingData: Partial<IClientContractLine>
): Promise<IClientContractLine> {
  try {
    const existingBilling = await ClientContractLine.getById(billingId);
    if (!existingBilling) {
      throw new Error(`Billing entry with ID ${billingId} not found`);
    }

    // Check for overlapping billing entries, excluding the current one
    const overlappingBillings = await ClientContractLine.checkOverlappingBilling(
      existingBilling.client_id,
      existingBilling.service_category || '',
      new Date(billingData.start_date || existingBilling.start_date),
      new Date(billingData.end_date! || existingBilling.end_date!),
      billingId
    );

    if (overlappingBillings.length > 0) {
      const conflictingBilling = overlappingBillings[0];
      throw new Error(`Cannot update contract line: overlapping contract line exists for client ${existingBilling.client_id} and service category "${existingBilling.service_category}". Conflicting entry: ID ${conflictingBilling.client_contract_line_id}, Start Date: ${conflictingBilling.start_date.slice(0, 10)}, End Date: ${conflictingBilling.end_date?.slice(0, 10) || 'Ongoing'}`);
    }

    // If no overlapping entries, update the billing
    const updatedBilling = await ClientContractLine.update(billingId, billingData);
    return updatedBilling;
  } catch (error) {
    console.error('Error updating client billing:', error);
    throw error;
  }
}

export async function getClientContractLine(clientId: string): Promise<IClientContractLine[]> {
  try {
    const billings = await ClientContractLine.getByClientId(clientId);
    return billings;
  } catch (error) {
    console.error('Error fetching client billing:', error);
    throw new Error('Failed to fetch client contract lines');
  }
}

export async function getOverlappingBillings(
  clientId: string,
  serviceCategory: string,
  startDate: Date,
  endDate: Date | null,
  excludeBillingId?: string
): Promise<IClientContractLine[]> {
  try {
    const overlappingBillings = await ClientContractLine.checkOverlappingBilling(
      clientId,
      serviceCategory,
      startDate,
      endDate,
      excludeBillingId
    );
    return overlappingBillings;
  } catch (error) {
    console.error('Error checking for overlapping billings:', error);
    throw new Error('Failed to check for overlapping contract lines');
  }
}
