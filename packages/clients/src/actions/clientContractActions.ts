// @ts-nocheck
// TODO: Model argument count issues
// @alga-psa/clients/actions.ts
'use server'

import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import ClientContract from '../models/clientContract';
import type { IClientContract } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { Temporal } from '@js-temporal/polyfill';
import { toPlainDate } from '@alga-psa/core';
import { cloneTemplateContractLineAsync } from '../lib/billingHelpers';
import { v4 as uuidv4 } from 'uuid';
import { checkAndReactivateExpiredContract } from '@alga-psa/shared/billingClients';
import { withAuth } from '@alga-psa/auth';

/**
 * Get all active contracts for a client.
 */
export const getClientContracts = withAuth(async (
  _user,
  { tenant },
  clientId: string
): Promise<IClientContract[]> => {
  try {
    const clientContracts = await ClientContract.getByClientId(clientId, tenant);
    return clientContracts;
  } catch (error) {
    console.error(`Error fetching contracts for client ${clientId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch client contracts: ${error}`);
  }
});

/**
 * Get active contracts for a list of clients.
 */
export const getActiveClientContractsByClientIds = withAuth(async (
  _user,
  { tenant },
  clientIds: string[]
): Promise<IClientContract[]> => {
  try {
    return await ClientContract.getActiveByClientIds(clientIds, tenant);
  } catch (error) {
    console.error('Error fetching contracts for clients:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to fetch client contracts: ${error}`);
  }
});

/**
 * Get a specific client contract by ID.
 */
export const getClientContractById = withAuth(async (
  _user,
  { tenant },
  clientContractId: string
): Promise<IClientContract | null> => {
  try {
    return await ClientContract.getById(clientContractId, tenant);
  } catch (error) {
    console.error(`Error fetching client contract ${clientContractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch client contract: ${error}`);
  }
});

/**
 * Get detailed information about a client's contract assignment.
 */
export const getDetailedClientContract = withAuth(async (
  _user,
  { tenant },
  clientContractId: string
): Promise<any | null> => {
  try {
    return await ClientContract.getDetailedClientContract(clientContractId, tenant);
  } catch (error) {
    console.error(`Error fetching detailed client contract ${clientContractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch detailed client contract: ${error}`);
  }
});

/**
 * Assign a contract to a client.
 */
export const assignContractToClient = withAuth(async (
  _user,
  { tenant },
  clientId: string,
  contractId: string,
  startDate: string,
  endDate: string | null = null
): Promise<IClientContract> => {
  try {
    const clientContract = await ClientContract.assignContractToClient(
      clientId,
      contractId,
      startDate,
      endDate,
      tenant
    );
    return clientContract;
  } catch (error) {
    console.error(`Error assigning contract ${contractId} to client ${clientId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to assign contract to client: ${error}`);
  }
});

export const createClientContract = withAuth(async (
  _user,
  { tenant },
  input: {
    client_id: string;
    contract_id: string;
    start_date: string;
    end_date: string | null;
    is_active: boolean;
    po_required?: boolean;
    po_number?: string | null;
    po_amount?: number | null;
  }
): Promise<IClientContract> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const clientExists = await trx('clients').where({ client_id: input.client_id, tenant }).first();
    if (!clientExists) {
      throw new Error(`Client ${input.client_id} not found or belongs to a different tenant`);
    }

    const contractExists = await trx('contracts')
      .where({ contract_id: input.contract_id, tenant, is_active: true })
      .first();

    if (!contractExists) {
      throw new Error(`Contract ${input.contract_id} not found, inactive, or belongs to a different tenant`);
    }

    if (input.is_active) {
      const overlapping = await trx('client_contracts')
        .where({ client_id: input.client_id, tenant, is_active: true })
        .where(function overlap() {
          this.where(function overlapsExistingEnd() {
            this.where('end_date', '>', input.start_date).orWhereNull('end_date');
          }).where(function overlapsExistingStart() {
            if (input.end_date) {
              this.where('start_date', '<', input.end_date);
            } else {
              this.whereRaw('1 = 1');
            }
          });
        })
        .first();

      if (overlapping) {
        throw new Error(`Client ${input.client_id} already has an active contract overlapping the specified range`);
      }
    }

    const timestamp = new Date().toISOString();
    const insertPayload: Record<string, unknown> = {
      client_contract_id: uuidv4(),
      client_id: input.client_id,
      contract_id: input.contract_id,
      template_contract_id: null,
      start_date: input.start_date,
      end_date: input.end_date,
      is_active: input.is_active,
      tenant,
      created_at: timestamp,
      updated_at: timestamp,
    };

    const hasPoRequired = await trx.schema.hasColumn('client_contracts', 'po_required');
    const hasPoNumber = await trx.schema.hasColumn('client_contracts', 'po_number');
    const hasPoAmount = await trx.schema.hasColumn('client_contracts', 'po_amount');

    if (hasPoRequired) insertPayload.po_required = Boolean(input.po_required);
    if (hasPoNumber) insertPayload.po_number = input.po_number ?? null;
    if (hasPoAmount) insertPayload.po_amount = input.po_amount ?? null;

    const [created] = await trx<IClientContract>('client_contracts').insert(insertPayload).returning('*');
    return created;
  });
});

/**
 * Update a client's contract assignment
 */
export const updateClientContract = withAuth(async (
  _user,
  { tenant },
  clientContractId: string,
  updateData: Partial<IClientContract>
): Promise<IClientContract> => {
  try {
    const { knex: db } = await createTenantKnex(); // Get knex instance

    // --- Start Validation ---
    if (updateData.start_date || updateData.end_date !== undefined) { // Check if dates are being updated (end_date can be null)
      // 1. Get current client contract details
      const currentContract = await ClientContract.getById(clientContractId, tenant);
      if (!currentContract) {
        throw new Error(`Client contract ${clientContractId} not found.`);
      }
      const clientId = currentContract.client_id;

      // 2. Determine proposed new dates
      const proposedStartDateStr = updateData.start_date ?? currentContract.start_date;
      // Handle null explicitly for end_date
      const proposedEndDateStr = updateData.end_date !== undefined ? updateData.end_date : currentContract.end_date;

      const proposedStartDate = toPlainDate(proposedStartDateStr);
      const proposedEndDate = proposedEndDateStr ? toPlainDate(proposedEndDateStr) : null;


      // 3. Fetch invoiced billing cycles for this client
      const invoicedCycles = await withTransaction(db, async (trx: Knex.Transaction) => {
        return await trx('client_billing_cycles as cbc')
          .join('invoices as i', function() {
            this.on('i.billing_cycle_id', '=', 'cbc.billing_cycle_id')
                .andOn('i.tenant', '=', 'cbc.tenant');
          })
          .where('cbc.client_id', clientId)
          .andWhere('cbc.tenant', tenant)
          // Add a check for invoice status if applicable, e.g., .andWhere('i.status', 'finalized')
          // Assuming any linked invoice means it's "invoiced" for now
          .select(
            'cbc.period_start_date',
            'cbc.period_end_date'
          );
      });

      // 4. Check for overlaps
      for (const cycle of invoicedCycles) {
        const cycleStartDate = toPlainDate(cycle.period_start_date);
        const cycleEndDate = toPlainDate(cycle.period_end_date); // Period end is exclusive: [start, end)

        // Overlap check using [start, end) semantics:
        // Overlap if: startA < endB && endA > startB (touching boundaries do not overlap).
        const proposedEndExclusive = proposedEndDate ? proposedEndDate.add({ days: 1 }) : null; // end_date is stored as inclusive date
        const startsBeforeCycleEnds = Temporal.PlainDate.compare(proposedStartDate, cycleEndDate) < 0;
        const endsAfterCycleStarts =
          proposedEndExclusive === null || Temporal.PlainDate.compare(proposedEndExclusive, cycleStartDate) > 0;

        if (startsBeforeCycleEnds && endsAfterCycleStarts) {
          throw new Error("Cannot change assignment dates as they overlap with an already invoiced period.");
        }
      }
    }
    // --- End Validation ---

    // Remove tenant field if present in updateData to prevent override
    const { tenant: _, ...safeUpdateData } = updateData as any;
    const updatedClientContract = await ClientContract.updateClientContract(clientContractId, safeUpdateData, tenant);

    // After updating the client contract, check if the parent contract should be reactivated
    // This handles the case where an expired contract's end dates are extended
    await checkAndReactivateExpiredContract(db, tenant, updatedClientContract.contract_id);

    return updatedClientContract;
  } catch (error) {
    console.error(`Error updating client contract ${clientContractId}:`, error);
    if (error instanceof Error) {
      // Re-throw specific known errors or validation errors
      if (error.message === "Cannot change assignment dates as they overlap with an already invoiced period.") {
          throw error;
      }
      // Preserve other specific error messages if needed
      // throw error;
    }
    // Throw a generic error for unexpected issues
    throw new Error(`Failed to update client contract: ${error instanceof Error ? error.message : String(error)}`);
  }
});

/**
 * Deactivate a client's contract assignment.
 */
export const deactivateClientContract = withAuth(async (
  _user,
  { tenant },
  clientContractId: string
): Promise<IClientContract> => {
  try {
    const deactivatedContract = await ClientContract.deactivateClientContract(clientContractId, tenant);
    return deactivatedContract;
  } catch (error) {
    console.error(`Error deactivating client contract ${clientContractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to deactivate client contract: ${error}`);
  }
});

/**
 * Get all contract lines associated with a client's contract
 */
export const getClientContractLines = withAuth(async (
  _user,
  { tenant },
  clientContractId: string
): Promise<any[]> => {
  try {
    const contractLines = await ClientContract.getContractLines(clientContractId, tenant);
    return contractLines;
  } catch (error) {
    console.error(`Error fetching contract lines for client contract ${clientContractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch contract lines for client contract: ${error}`);
  }
});

/**
 * Apply a client's contract lines to the client
 * This populates services and configuration for each contract_line in the contract.
 * The contract_lines already exist - this clones the template services/configuration.
 */
export const applyContractToClient = withAuth(async (
  _user,
  { tenant },
  clientContractId: string
): Promise<void> => {
  const { knex: db } = await createTenantKnex();

  try {
    // Get the client contract
    const clientContract = await ClientContract.getById(clientContractId, tenant);
    if (!clientContract) {
      throw new Error(`Client contract ${clientContractId} not found`);
    }

    // Get all contract lines associated with the contract
    const contractLines = await ClientContract.getContractLines(clientContractId, tenant);
    if (contractLines.length === 0) {
      throw new Error(`No contract lines found in contract ${clientContract.contract_id}`);
    }

    // Start a transaction to populate services/configuration for each line
    await withTransaction(db, async (trx: Knex.Transaction) => {
      const templateContractId = clientContract.template_contract_id ?? clientContract.contract_id ?? null;

      for (const line of contractLines) {
        // Clone services and configuration from template to this contract line
        await cloneTemplateContractLineAsync(trx, {
          tenant,
          templateContractLineId: line.contract_line_id,
          contractLineId: line.contract_line_id,
          templateContractId,
          overrideRate: line.custom_rate ?? null,
          effectiveDate: clientContract.start_date ?? null
        });
      }
    });
  } catch (error) {
    console.error(`Error applying contract ${clientContractId} to client:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to apply contract to client: ${error}`);
  }
});
