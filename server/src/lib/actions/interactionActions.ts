// server/src/lib/actions/interactionActions.ts

'use server'

import { revalidatePath } from 'next/cache'
import InteractionModel from 'server/src/lib/models/interactions'
import { IInteractionType, IInteraction } from 'server/src/interfaces/interaction.interfaces'
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions'

import { createTenantKnex } from 'server/src/lib/db';

export async function addInteraction(interactionData: Omit<IInteraction, 'interaction_date'>): Promise<IInteraction> {
  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    
    console.log('Received interaction data:', interactionData);

    if (!interactionData.user_id) {
      throw new Error('User ID is missing');
    }

    if (!interactionData.company_id && !interactionData.contact_name_id) {
      throw new Error('Either company_id or contact_name_id must be provided');
    }

    const newInteraction = await InteractionModel.addInteraction({
      ...interactionData,
      tenant,
      interaction_date: new Date(),
    });

    console.log('New interaction created:', newInteraction);

    revalidatePath('/msp/contacts/[id]', 'page')
    revalidatePath('/msp/companies/[id]', 'page')
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
    return await InteractionModel.getInteractionTypes();
  } catch (error) {
    console.error('Error fetching interaction types:', error)
    throw new Error('Failed to fetch interaction types')
  }
}

export async function getInteractionsForEntity(entityId: string, entityType: 'contact' | 'company'): Promise<IInteraction[]> {
  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    return await InteractionModel.getForEntity(entityId, entityType);
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
    return await InteractionModel.getRecentInteractions(filters);
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
    const updatedInteraction = await InteractionModel.updateInteraction(interactionId, updateData);
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
    const interaction = await InteractionModel.getById(interactionId);
    if (!interaction) {
      throw new Error('Interaction not found');
    }
    return interaction;
  } catch (error) {
    console.error('Error fetching interaction:', error);
    throw new Error('Failed to fetch interaction');
  }
}