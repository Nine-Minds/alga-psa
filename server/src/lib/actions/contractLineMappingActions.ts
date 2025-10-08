// server/src/lib/actions/contractLineMappingActions.ts
'use server'

import ContractLineMapping from 'server/src/lib/models/contractLineMapping';
import { IContractLineMapping } from 'server/src/interfaces/contract.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { getSession } from 'server/src/lib/auth/getSession';

/**
 * Retrieve all contract line mappings for a contract.
 */
export async function getContractLineMappings(contractId: string): Promise<IContractLineMapping[]> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    return await ContractLineMapping.getByContractId(contractId);
  } catch (error) {
    console.error(`Error fetching contract line mappings for contract ${contractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch contract line mappings: ${error}`);
  }
}

/**
 * Retrieve detailed contract line mappings for a contract.
 */
export async function getDetailedContractLines(contractId: string): Promise<any[]> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    return await ContractLineMapping.getDetailedContractLines(contractId);
  } catch (error) {
    console.error(`Error fetching detailed contract line mappings for contract ${contractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch detailed contract line mappings: ${error}`);
  }
}

/**
 * Associate a contract line with a contract.
 */
export async function addContractLine(
  contractId: string, 
  contractLineId: string, 
  customRate?: number
): Promise<IContractLineMapping> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    return await ContractLineMapping.addContractLine(contractId, contractLineId, customRate);
  } catch (error) {
    console.error(`Error adding contract line ${contractLineId} to contract ${contractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to add contract line to contract: ${error}`);
  }
}

/**
 * Remove a contract line association.
 */
export async function removeContractLine(contractId: string, contractLineId: string): Promise<void> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    await ContractLineMapping.removeContractLine(contractId, contractLineId);
  } catch (error) {
    console.error(`Error removing contract line ${contractLineId} from contract ${contractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages including "Cannot remove contract line from contract as it is currently assigned to clients"
    }
    throw new Error(`Failed to remove contract line from contract: ${error}`);
  }
}

/**
 * Update metadata for a contract line association.
 */
export async function updateContractLineAssociation(
  contractId: string, 
  contractLineId: string, 
  updateData: Partial<IContractLineMapping>
): Promise<IContractLineMapping> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    // Prepare data specifically for the database update
    // Use a more generic type to allow assigning null
    const dbUpdateData: { [key: string]: any } = { ...updateData };

    // Convert undefined custom_rate to null for the database update
    if (dbUpdateData.custom_rate === undefined) {
      dbUpdateData.custom_rate = null;
    }

    // Remove tenant field if present to prevent override
    delete dbUpdateData.tenant;

    const updated = await ContractLineMapping.updateContractLineAssociation(contractId, contractLineId, dbUpdateData);
    return updated;
  } catch (error) {
    console.error(`Error updating contract line ${contractLineId} for contract ${contractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to update contract line association: ${error}`);
  }
}

/**
 * Determine whether a contract line is already associated with a contract.
 */
export async function isContractLineAttached(contractId: string, contractLineId: string): Promise<boolean> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    return await ContractLineMapping.isContractLineAttached(contractId, contractLineId);
  } catch (error) {
    console.error(`Error checking if contract line ${contractLineId} is associated with contract ${contractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to check contract line association: ${error}`);
  }
}
