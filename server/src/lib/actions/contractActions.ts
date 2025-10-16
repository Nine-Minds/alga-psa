// server/src/lib/actions/contractActions.ts
'use server'

import Contract from 'server/src/lib/models/contract';
import { IContract, IContractAssignmentSummary, IContractWithClient } from 'server/src/interfaces/contract.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { getSession } from 'server/src/lib/auth/getSession';

export async function getContracts(): Promise<IContract[]> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    return await Contract.getAll();
  } catch (error) {
    console.error('Error fetching contracts:', error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch contracts: ${error}`);
  }
}

export async function getContractsWithClients(): Promise<IContractWithClient[]> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    return await Contract.getAllWithClients();
  } catch (error) {
    console.error('Error fetching contracts with clients:', error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch contracts with clients: ${error}`);
  }
}

export async function getContractById(contractId: string): Promise<IContract | null> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    return await Contract.getById(contractId);
  } catch (error) {
    console.error(`Error fetching contract ${contractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch contract: ${error}`);
  }
}

export async function createContract(
  contractData: Omit<IContract, 'contract_id' | 'tenant' | 'created_at' | 'updated_at'>
): Promise<IContract> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }

  try {
    const { tenant: _, ...safeContractData } = contractData as any;
    return await Contract.create(safeContractData);
  } catch (error) {
    console.error('Error creating contract:', error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to create contract in tenant ${tenant}: ${error}`);
  }
}

export async function updateContract(
  contractId: string,
  updateData: Partial<IContract>
): Promise<IContract> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }

  try {
    // Get the current contract to check its status
    const currentContract = await Contract.getById(contractId);
    if (!currentContract) {
      throw new Error(`Contract ${contractId} not found`);
    }

    // Special handling for expired contracts
    if (currentContract.status === 'expired') {
      // If trying to manually change status of an expired contract (not through end date logic)
      if (updateData.status && updateData.status !== 'expired') {
        throw new Error('Cannot manually change the status of an expired contract. To reactivate, extend the contract end date.');
      }

      // Check if end dates are being updated on client contracts
      // We'll check this after the client contract updates below
      // For now, remove the status from updateData if it's expired (we'll handle it automatically)
      if (updateData.status === 'expired') {
        delete updateData.status; // Don't update status, we'll determine it based on end dates
      }
    } else {
      // Prevent manual setting of expired status on non-expired contracts
      if (updateData.status === 'expired') {
        throw new Error('Cannot manually set contract to expired. Contracts are automatically expired when their end date passes.');
      }
    }

    // If trying to set contract to draft, check if it has invoices
    if (updateData.status === 'draft') {
      const hasInvoices = await Contract.hasInvoices(contractId);
      if (hasInvoices) {
        throw new Error('Cannot set contract to draft because it has associated invoices. Contracts with invoices cannot be set to draft.');
      }
    }

    // If trying to set contract to active, check if client already has an active contract
    if (updateData.status === 'active') {
      // Get all clients assigned to this contract
      const clientContracts = await knex('client_contracts')
        .where({ contract_id: contractId, tenant })
        .select('client_id');

      for (const cc of clientContracts) {
        const hasActiveContract = await Contract.hasActiveContractForClient(cc.client_id, contractId);
        if (hasActiveContract) {
          throw new Error('Client already has an active contract. To create a new active contract, terminate their current contract or save this contract as a draft.');
        }
      }
    }

    const { tenant: _, ...safeUpdateData } = updateData as any;
    const updated = await Contract.update(contractId, safeUpdateData);

    // After updating, check if an expired contract should be reactivated based on end dates
    if (currentContract.status === 'expired') {
      await Contract.checkAndReactivateExpiredContract(contractId);
      // Re-fetch the contract to get the potentially updated status
      const reactivatedContract = await Contract.getById(contractId);
      return reactivatedContract!;
    }

    return updated;
  } catch (error) {
    console.error('Error updating contract:', error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to update contract in tenant ${tenant}: ${error}`);
  }
}

export async function deleteContract(contractId: string): Promise<void> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }

  try {
    await Contract.delete(contractId);
  } catch (error) {
    console.error('Error deleting contract:', error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages from the model
    }
    throw new Error(`Failed to delete contract in tenant ${tenant}: ${error}`);
  }
}

export async function getContractLinesForContract(contractId: string): Promise<any[]> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    return await Contract.getContractLines(contractId);
  } catch (error) {
    console.error(`Error fetching contract lines for contract ${contractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch contract lines: ${error}`);
  }
}

export interface IContractSummary {
  contractLineCount: number;
  totalClientAssignments: number;
  activeClientCount: number;
  poRequiredCount: number;
  poNumbers: string[];
  earliestStartDate: string | null;
  latestEndDate: string | null;
}

export async function getContractSummary(contractId: string): Promise<IContractSummary> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }

    const result = await knex('contract_line_mappings')
      .where({ contract_id: contractId, tenant })
      .count<{ count: string }>('* as count');
    const lineCountRaw = result[0]?.count;

    const hasPoRequired = await knex.schema.hasColumn('client_contracts', 'po_required');
    const hasPoNumber = await knex.schema.hasColumn('client_contracts', 'po_number');

    const assignmentColumns = [
      'client_contract_id',
      'client_id',
      'is_active',
      'start_date',
      'end_date'
    ];

    if (hasPoRequired) {
      assignmentColumns.push('po_required');
    }

    if (hasPoNumber) {
      assignmentColumns.push('po_number');
    }

    const assignmentsRaw = await knex('client_contracts')
      .where({ contract_id: contractId, tenant })
      .select(assignmentColumns);

    const assignments = assignmentsRaw.map((assignment: any) => ({
      ...assignment,
      po_required: hasPoRequired ? Boolean(assignment.po_required) : false,
      po_number: hasPoNumber ? assignment.po_number : undefined,
    }));

    const totalAssignments = assignments.length;
    const activeAssignments = assignments.filter((assignment) => assignment.is_active).length;
    const poRequiredAssignments = assignments.filter((assignment) => assignment.po_required).length;

    const poNumbers = Array.from(
      new Set(
        assignments
          .map((assignment) => assignment.po_number)
          .filter((poNumber): poNumber is string => Boolean(poNumber))
      )
    );

    const startDates = assignments
      .map((assignment) => assignment.start_date)
      .filter((value): value is string => Boolean(value))
      .sort();

    const endDates = assignments
      .map((assignment) => assignment.end_date)
      .filter((value): value is string => Boolean(value))
      .sort();

    return {
      contractLineCount: Number(lineCountRaw ?? 0),
      totalClientAssignments: totalAssignments,
      activeClientCount: activeAssignments,
      poRequiredCount: poRequiredAssignments,
      poNumbers,
      earliestStartDate: startDates[0] ?? null,
      latestEndDate: endDates.length > 0 ? endDates[endDates.length - 1] : null,
    };
  } catch (error) {
    console.error(`Error computing summary for contract ${contractId}:`, error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to compute contract summary: ${error}`);
  }
}

export async function checkClientHasActiveContract(clientId: string, excludeContractId?: string): Promise<boolean> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    return await Contract.hasActiveContractForClient(clientId, excludeContractId);
  } catch (error) {
    console.error(`Error checking active contract for client ${clientId}:`, error);
    throw error;
  }
}

export async function getContractAssignments(contractId: string): Promise<IContractAssignmentSummary[]> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }

    const hasPoRequired = await knex.schema.hasColumn('client_contracts', 'po_required');
    const hasPoNumber = await knex.schema.hasColumn('client_contracts', 'po_number');
    const hasPoAmount = await knex.schema.hasColumn('client_contracts', 'po_amount');

    const selection = [
      'cc.client_contract_id',
      'cc.client_id',
      'cc.start_date',
      'cc.end_date',
      'cc.is_active',
      'cc.tenant',
      'c.client_name'
    ];

    if (hasPoRequired) {
      selection.push('cc.po_required');
    }
    if (hasPoNumber) {
      selection.push('cc.po_number');
    }
    if (hasPoAmount) {
      selection.push('cc.po_amount');
    }

    const rows = await knex('client_contracts as cc')
      .leftJoin('clients as c', function joinClients() {
        this.on('cc.client_id', '=', 'c.client_id').andOn('cc.tenant', '=', 'c.tenant');
      })
      .where({ 'cc.contract_id': contractId, 'cc.tenant': tenant })
      .select(selection)
      .orderBy('cc.start_date', 'asc');

    return rows.map((row: any) => ({
      client_contract_id: row.client_contract_id,
      client_id: row.client_id,
      client_name: row.client_name ?? null,
      start_date: row.start_date ?? null,
      end_date: row.end_date ?? null,
      is_active: row.is_active ?? false,
      po_required: hasPoRequired ? Boolean(row.po_required) : false,
      po_number: hasPoNumber ? row.po_number : undefined,
      po_amount: hasPoAmount ? row.po_amount : undefined,
      tenant: row.tenant,
    }));
  } catch (error) {
    console.error(`Error fetching assignments for contract ${contractId}:`, error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to fetch contract assignments: ${error}`);
  }
}
