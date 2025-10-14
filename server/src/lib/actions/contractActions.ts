// server/src/lib/actions/contractActions.ts
'use server'

import Contract from 'server/src/lib/models/contract';
import { IContract } from 'server/src/interfaces/contract.interfaces';
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

  const { tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }

  try {
    const { tenant: _, ...safeUpdateData } = updateData as any;
    return await Contract.update(contractId, safeUpdateData);
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
    const isInUse = await Contract.isInUse(contractId);
    if (isInUse) {
      throw new Error(`Cannot delete contract that is currently in use by clients in tenant ${tenant}`);
    }

    await Contract.delete(contractId);
  } catch (error) {
    console.error('Error deleting contract:', error);
    if (error instanceof Error) {
      if (error.message.includes('in use')) {
        throw new Error(`Cannot delete contract that is currently in use by clients in tenant ${tenant}`);
      }
      throw error; // Preserve other specific error messages
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

    const [{ count: lineCountRaw }] = await knex('contract_line_mappings')
      .where({ contract_id: contractId, tenant })
      .count<{ count: string }>('* as count');

    const hasPoNumber = await knex.schema.hasColumn('client_contracts', 'po_number');
    const hasPoRequired = await knex.schema.hasColumn('client_contracts', 'po_required');

    const assignmentColumns = [
      'client_contract_id',
      'client_id',
      'is_active',
      'start_date',
      'end_date',
    ];

    if (hasPoRequired) {
      assignmentColumns.push('po_required');
    }
    if (hasPoNumber) {
      assignmentColumns.push('po_number');
    }

    const assignments = await knex('client_contracts')
      .where({ contract_id: contractId, tenant })
      .select(assignmentColumns);

    const totalAssignments = assignments.length;
    const activeAssignments = assignments.filter((assignment) => assignment.is_active).length;
    const poRequiredAssignments = hasPoRequired
      ? assignments.filter((assignment) => Boolean((assignment as any).po_required)).length
      : 0;

    const poNumbers = hasPoNumber
      ? Array.from(
        new Set(
          assignments
            .map((assignment) => (assignment as any).po_number as string | null | undefined)
            .filter((poNumber): poNumber is string => Boolean(poNumber))
        )
      )
      : [];

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
