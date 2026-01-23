// @alga-psa/clients/actions.ts

'use server'

import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { revalidatePath } from 'next/cache'
import InteractionModel from '../models/interactions';
import { IInteractionType, IInteraction } from '@alga-psa/types'
import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildInteractionLoggedPayload } from '@alga-psa/shared/workflow/streams/domainEventBuilders/crmInteractionNoteEventBuilders';

import { createTenantKnex } from '@alga-psa/db';

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

function maybeUserActor(currentUser: any) {
  const userId = currentUser?.user_id;
  if (typeof userId !== 'string' || !userId) return undefined;
  return { actorType: 'USER' as const, actorUserId: userId };
}

export async function addInteraction(interactionData: Omit<IInteraction, 'interaction_date'>): Promise<IInteraction> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('Unauthorized');
    }
    const { knex: db, tenant } = await createTenantKnex(currentUser.tenant);
    if (!tenant) {
      throw new Error('Tenant not found');
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

      let resolvedClientId = interactionData.client_id;
      if (!resolvedClientId && interactionData.contact_name_id) {
        const contact = await trx('contacts')
          .where({ tenant, contact_name_id: interactionData.contact_name_id })
          .select('client_id')
          .first();
        resolvedClientId = contact?.client_id ?? null;
      }

      if (!resolvedClientId) {
        throw new Error('Interactions must be linked to a client');
      }
      
      return await InteractionModel.addInteraction({
        ...interactionData,
        client_id: resolvedClientId,
        status_id,
        tenant,
        interaction_date: new Date(),
      });
    });

    console.log('New interaction created:', newInteraction);

    const occurredAt =
      newInteraction.interaction_date instanceof Date
        ? newInteraction.interaction_date.toISOString()
        : new Date(newInteraction.interaction_date as any).toISOString();

    const interactionType =
      typeof (newInteraction as any).type_name === 'string' && (newInteraction as any).type_name
        ? String((newInteraction as any).type_name)
        : 'interaction';

    await publishWorkflowEvent({
      eventType: 'INTERACTION_LOGGED',
      payload: buildInteractionLoggedPayload({
        interactionId: newInteraction.interaction_id,
        clientId: newInteraction.client_id as string,
        ...(newInteraction.contact_name_id ? { contactId: newInteraction.contact_name_id } : {}),
        interactionType,
        interactionOccurredAt: occurredAt,
        loggedByUserId: newInteraction.user_id,
        ...(typeof newInteraction.title === 'string' && newInteraction.title ? { subject: newInteraction.title } : {}),
        ...(typeof (newInteraction as any).status_name === 'string' && (newInteraction as any).status_name
          ? { outcome: String((newInteraction as any).status_name) }
          : {}),
      }),
      ctx: { tenantId: tenant, occurredAt, actor: maybeUserActor(currentUser) },
      idempotencyKey: `interaction_logged:${newInteraction.interaction_id}:${occurredAt}`,
    });

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
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('Unauthorized');
    }
    const { knex } = await createTenantKnex(currentUser.tenant);
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
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('Unauthorized');
    }
    const { knex } = await createTenantKnex(currentUser.tenant);
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
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('Unauthorized');
    }
    const { knex } = await createTenantKnex(currentUser.tenant);
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
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('Unauthorized');
    }
    const { knex } = await createTenantKnex(currentUser.tenant);
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
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('Unauthorized');
    }
    const { knex } = await createTenantKnex(currentUser.tenant);
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
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('Unauthorized');
    }
    const { knex, tenant } = await createTenantKnex(currentUser.tenant);
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
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('Unauthorized');
    }
    const { knex, tenant } = await createTenantKnex(currentUser.tenant);

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
