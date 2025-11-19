'use server'

import ClientContract from 'server/src/lib/models/clientContract';
import Contract from 'server/src/lib/models/contract';
import { IClientContract } from 'server/src/interfaces/contract.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { getSession } from 'server/src/lib/auth/getSession';
import { v4 as uuidv4 } from 'uuid';

interface CreateClientContractData {
  client_id: string;
  contract_id: string;
  start_date: string;
  end_date?: string | null;
  is_active?: boolean;
  po_required?: boolean;
  po_number?: string | null;
  po_amount?: number | null;
}

export async function createClientContract(
  data: CreateClientContractData
): Promise<IClientContract> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant context not found');
  }

  try {
    // Verify client exists
    const clientExists = await knex('clients')
      .where({ client_id: data.client_id, tenant })
      .first();

    if (!clientExists) {
      throw new Error(`Client ${data.client_id} not found`);
    }

    // Verify contract exists
    const contractExists = await knex('contracts')
      .where({ contract_id: data.contract_id, tenant })
      .first();

    if (!contractExists) {
      throw new Error(`Contract ${data.contract_id} not found`);
    }

    // If contract is active, check if client already has an active contract
    if (contractExists.status === 'active') {
      const hasActiveContract = await Contract.hasActiveContractForClient(data.client_id, data.contract_id);
      if (hasActiveContract) {
        throw new Error('Client already has an active contract. To create a new active contract, terminate their current contract or save this contract as a draft.');
      }
    }

    const timestamp = new Date().toISOString();
    const insertPayload: any = {
      client_contract_id: uuidv4(),
      client_id: data.client_id,
      contract_id: data.contract_id,
      start_date: data.start_date,
      end_date: data.end_date || null,
      is_active: data.is_active ?? true,
      tenant,
      created_at: timestamp,
      updated_at: timestamp,
    };

    // Add PO fields if they exist in the schema
    const hasPoRequired = await knex.schema.hasColumn('client_contracts', 'po_required');
    const hasPoNumber = await knex.schema.hasColumn('client_contracts', 'po_number');
    const hasPoAmount = await knex.schema.hasColumn('client_contracts', 'po_amount');

    if (hasPoRequired && data.po_required !== undefined) {
      insertPayload.po_required = data.po_required;
    }
    if (hasPoNumber && data.po_number !== undefined) {
      insertPayload.po_number = data.po_number;
    }
    if (hasPoAmount && data.po_amount !== undefined) {
      insertPayload.po_amount = data.po_amount;
    }

    const [created] = await knex<IClientContract>('client_contracts')
      .insert(insertPayload)
      .returning('*');

    return created;
  } catch (error) {
    console.error('Error creating client contract:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to create client contract: ${error}`);
  }
}
