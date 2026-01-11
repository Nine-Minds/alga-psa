// server/src/lib/actions/clientContractActions.ts
'use server'

import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import ClientContract from 'server/src/lib/models/clientContract';
import { IClientContract } from 'server/src/interfaces/contract.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { Temporal } from '@js-temporal/polyfill';
import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils';
import { getSession } from 'server/src/lib/auth/getSession';
import { cloneTemplateContractLine } from 'server/src/lib/billing/utils/templateClone';

/**
 * Get all active contracts for a client.
 */
export async function getClientContracts(clientId: string): Promise<IClientContract[]> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const clientContracts = await ClientContract.getByClientId(clientId);
    return clientContracts;
  } catch (error) {
    console.error(`Error fetching contracts for client ${clientId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch client contracts: ${error}`);
  }
}

/**
 * Get active contracts for a list of clients.
 */
export async function getActiveClientContractsByClientIds(clientIds: string[]): Promise<IClientContract[]> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    return await ClientContract.getActiveByClientIds(clientIds);
  } catch (error) {
    console.error('Error fetching contracts for clients:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to fetch client contracts: ${error}`);
  }
}

/**
 * Get a specific client contract by ID.
 */
export async function getClientContractById(clientContractId: string): Promise<IClientContract | null> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    return await ClientContract.getById(clientContractId);
  } catch (error) {
    console.error(`Error fetching client contract ${clientContractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch client contract: ${error}`);
  }
}

/**
 * Get detailed information about a client's contract assignment.
 */
export async function getDetailedClientContract(clientContractId: string): Promise<any | null> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    return await ClientContract.getDetailedClientContract(clientContractId);
  } catch (error) {
    console.error(`Error fetching detailed client contract ${clientContractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch detailed client contract: ${error}`);
  }
}

/**
 * Assign a contract to a client.
 */
export async function assignContractToClient(
  clientId: string, 
  contractId: string, 
  startDate: string,
  endDate: string | null = null
): Promise<IClientContract> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const clientContract = await ClientContract.assignContractToClient(
      clientId, 
      contractId, 
      startDate,
      endDate
    );
    return clientContract;
  } catch (error) {
    console.error(`Error assigning contract ${contractId} to client ${clientId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to assign contract to client: ${error}`);
  }
}

/**
 * Update a client's contract assignment
 */
export async function updateClientContract(
  clientContractId: string, 
  updateData: Partial<IClientContract>
): Promise<IClientContract> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { knex: db, tenant } = await createTenantKnex(); // Get knex instance
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    // --- Start Validation ---
    if (updateData.start_date || updateData.end_date !== undefined) { // Check if dates are being updated (end_date can be null)
      // 1. Get current client contract details
      const currentContract = await ClientContract.getById(clientContractId);
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
    const updatedClientContract = await ClientContract.updateClientContract(clientContractId, safeUpdateData);

    // After updating the client contract, check if the parent contract should be reactivated
    // This handles the case where an expired contract's end dates are extended
    const Contract = (await import('server/src/lib/models/contract')).default;
    await Contract.checkAndReactivateExpiredContract(updatedClientContract.contract_id);

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
}

/**
 * Deactivate a client's contract assignment.
 */
export async function deactivateClientContract(clientContractId: string): Promise<IClientContract> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const deactivatedContract = await ClientContract.deactivateClientContract(clientContractId);
    return deactivatedContract;
  } catch (error) {
    console.error(`Error deactivating client contract ${clientContractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to deactivate client contract: ${error}`);
  }
}

/**
 * Get all contract lines associated with a client's contract
 */
export async function getClientContractLines(clientContractId: string): Promise<any[]> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const contractLines = await ClientContract.getContractLines(clientContractId);
    return contractLines;
  } catch (error) {
    console.error(`Error fetching contract lines for client contract ${clientContractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch contract lines for client contract: ${error}`);
  }
}

/**
 * Apply a client's contract lines to the client
 * This populates services and configuration for each contract_line in the contract.
 * The contract_lines already exist - this clones the template services/configuration.
 */
export async function applyContractToClient(clientContractId: string): Promise<void> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }

  try {
    // Get the client contract
    const clientContract = await ClientContract.getById(clientContractId);
    if (!clientContract) {
      throw new Error(`Client contract ${clientContractId} not found`);
    }

    // Get all contract lines associated with the contract
    const contractLines = await ClientContract.getContractLines(clientContractId);
    if (contractLines.length === 0) {
      throw new Error(`No contract lines found in contract ${clientContract.contract_id}`);
    }

    // Start a transaction to populate services/configuration for each line
    await withTransaction(db, async (trx: Knex.Transaction) => {
      const templateContractId = clientContract.template_contract_id ?? clientContract.contract_id ?? null;

      for (const line of contractLines) {
        // Clone services and configuration from template to this contract line
        await cloneTemplateContractLine(trx, {
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
}
