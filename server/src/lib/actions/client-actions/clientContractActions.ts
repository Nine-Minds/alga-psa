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
        const cycleEndDate = toPlainDate(cycle.period_end_date); // Invoiced cycles should always have an end date

        // Overlap check: (StartA <= EndB) and (EndA >= StartB)
        const startsBeforeCycleEnds = Temporal.PlainDate.compare(proposedStartDate, cycleEndDate) <= 0;
        // If proposed end date is null (open-ended), it overlaps if it starts before the cycle ends.
        // Otherwise, check if the proposed end date is after or on the cycle start date.
        const endsAfterCycleStarts = proposedEndDate === null || Temporal.PlainDate.compare(proposedEndDate, cycleStartDate) >= 0;

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
 * This creates client_contract_line entries for each plan in the contract
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

    // Start a transaction to ensure all client contract lines are created
    await withTransaction(db, async (trx: Knex.Transaction) => {
      // For each contract line in the contract, create a client contract line
      const templateContractId = clientContract.template_contract_id ?? clientContract.contract_id ?? null;

      for (const plan of contractLines) {
        // Check if the client already has this plan
        const existingPlan = await trx('client_contract_lines')
          .where({ 
            client_id: clientContract.client_id,
            contract_line_id: plan.contract_line_id,
            is_active: true,
            tenant 
          })
          .first();

        let targetClientContractLineId: string;

        if (existingPlan) {
          // If the contract line exists but isn't linked to this contract, update it
          if (!existingPlan.client_contract_id) {
            await trx('client_contract_lines')
              .where({ 
                client_contract_line_id: existingPlan.client_contract_line_id,
                tenant 
              })
              .update({ 
                client_contract_id: clientContractId,
                template_contract_line_id: plan.contract_line_id,
                updated_at: trx.fn.now()
              });
          }

          targetClientContractLineId = existingPlan.client_contract_line_id;
        } else {
          // Create a new client contract line
          const [created] = await trx('client_contract_lines')
            .insert({
              client_contract_line_id: trx.raw('gen_random_uuid()'),
              client_id: clientContract.client_id,
              contract_line_id: plan.contract_line_id,
              template_contract_line_id: plan.contract_line_id,
              start_date: clientContract.start_date,
              end_date: clientContract.end_date,
              is_active: true,
              client_contract_id: clientContractId,
              tenant
            })
            .returning('client_contract_line_id');

          targetClientContractLineId = created.client_contract_line_id;
        }

        await cloneTemplateContractLine(trx, {
          tenant,
          templateContractLineId: plan.contract_line_id,
          clientContractLineId: targetClientContractLineId,
          templateContractId,
          overrideRate: existingPlan?.custom_rate ?? null,
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
