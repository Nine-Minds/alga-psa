// server/src/lib/actions/interactionActions.ts

'use server'

import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { revalidatePath } from 'next/cache'
import InteractionModel from 'server/src/lib/models/interactions'
import { IInteractionType, IInteraction } from 'server/src/interfaces/interaction.interfaces'
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions'

import { createTenantKnex } from 'server/src/lib/db';

// Helper function to get default status ID for interactions
async function getDefaultInteractionStatusId(trx: any, tenant: string): Promise<string> {
  const defaultStatus = await trx('statuses')
    .where({ 
      tenant,
      is_default: true,
      status_type: 'interaction'
    })
    .first();

  if (!defaultStatus) {
    throw new Error('No default status found for interactions');
  }

  return defaultStatus.status_id;
}

export async function addInteraction(interactionData: Omit<IInteraction, 'interaction_date'>): Promise<IInteraction> {
  try {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    
    console.log('Received interaction data:', interactionData);

    if (!interactionData.user_id) {
      throw new Error('User ID is missing');
    }

    if (!interactionData.client_id && !interactionData.contact_name_id) {
      throw new Error('Either client_id or contact_name_id must be provided');
    }

    const newInteraction = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Set default status if none provided
      const status_id = interactionData.status_id || await getDefaultInteractionStatusId(trx, tenant);
      
      return await InteractionModel.addInteraction({
        ...interactionData,
        status_id,
        tenant,
        interaction_date: new Date(),
      });
    });

    console.log('New interaction created:', newInteraction);

    revalidatePath('/msp/contacts/[id]', 'page')
    revalidatePath('/msp/clients/[id]', 'page')
    return newInteraction;
  } catch (error) {
    console.error('Error adding interaction:', error)
    throw new Error('Failed to add interaction')
  }
}

export async function getInteractionTypes(): Promise<IInteractionType[]> {
  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await InteractionModel.getInteractionTypes();
    });
  } catch (error) {
    console.error('Error fetching interaction types:', error)
    throw new Error('Failed to fetch interaction types')
  }
}

export async function getInteractionsForEntity(entityId: string, entityType: 'contact' | 'client'): Promise<IInteraction[]> {
  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await InteractionModel.getForEntity(entityId, entityType);
    });
  } catch (error) {
    console.error(`Error fetching interactions for ${entityType}:`, error);
    throw new Error(`Failed to fetch interactions for ${entityType}`);
  }
}

export async function getRecentInteractions(filters: {
  userId?: string;
  contactId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  typeId?: string;
}): Promise<IInteraction[]> {
  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await InteractionModel.getRecentInteractions(filters);
    });
  } catch (error) {
    console.error('Error fetching recent interactions:', error);
    throw new Error('Failed to fetch recent interactions');
  }
}

export async function updateInteraction(interactionId: string, updateData: Partial<IInteraction>): Promise<IInteraction> {
  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    const { knex } = await createTenantKnex();
    const updatedInteraction = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await InteractionModel.updateInteraction(interactionId, updateData);
    });
    revalidatePath('/msp/interactions/[id]', 'page');
    return updatedInteraction;
  } catch (error) {
    console.error('Error updating interaction:', error);
    throw new Error('Failed to update interaction');
  }
}

export async function getInteractionById(interactionId: string): Promise<IInteraction> {
  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    const { knex } = await createTenantKnex();
    const interaction = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await InteractionModel.getById(interactionId);
    });
    if (!interaction) {
      throw new Error('Interaction not found');
    }
    return interaction;
  } catch (error) {
    console.error('Error fetching interaction:', error);
    throw new Error('Failed to fetch interaction');
  }
}

export async function getInteractionStatuses(): Promise<any[]> {
  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('statuses')
        .where({ 
          tenant,
          status_type: 'interaction'
        })
        .select('*')
        .orderBy('order_number');
    });
  } catch (error) {
    console.error('Error fetching interaction statuses:', error);
    throw new Error('Failed to fetch interaction statuses');
  }
}

export async function deleteInteraction(interactionId: string): Promise<void> {
  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    const { knex } = await createTenantKnex();
    
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Delete the interaction
      const deletedCount = await trx('interactions')
        .where({ 
          interaction_id: interactionId,
          tenant 
        })
        .del();

      if (deletedCount === 0) {
        throw new Error('Interaction not found or could not be deleted');
      }

      revalidatePath('/'); // Revalidate to update any cached data
    });
  } catch (error) {
    console.error('Error deleting interaction:', error);
    throw new Error('Failed to delete interaction');
  }
}