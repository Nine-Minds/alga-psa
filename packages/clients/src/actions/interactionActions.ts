// @alga-psa/clients/actions.ts

'use server'

import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { revalidatePath } from 'next/cache'
import { StorageService } from '@alga-psa/storage/StorageService';
import InteractionModel from '../models/interactions';
import { IInteractionType, IInteraction } from '@alga-psa/types'
import { withAuth } from '@alga-psa/auth';
import {
  createInteractionWithSideEffects,
  publishInteractionSearchEvent,
} from './interactionCreateHelper';

import { createTenantKnex } from '@alga-psa/db';

export const addInteraction = withAuth(async (
  user,
  { tenant },
  interactionData: Omit<IInteraction, 'interaction_date'>
): Promise<IInteraction> => {
  try {
    const { knex: db } = await createTenantKnex();

    console.log('Received interaction data:', interactionData);

    if (!interactionData.user_id) {
      throw new Error('User ID is missing');
    }

    if (!interactionData.client_id && !interactionData.contact_name_id) {
      throw new Error('Either client_id or contact_name_id must be provided');
    }

    let publishSideEffects: (() => Promise<void>) | undefined;
    const newInteraction = await withTransaction(db, async (trx: Knex.Transaction) => {
      const result = await createInteractionWithSideEffects({
        tenant,
        trx,
        user,
        interactionData,
      });
      publishSideEffects = result.publishSideEffects;
      return result.interaction;
    });

    console.log('New interaction created:', newInteraction);
    await publishSideEffects?.();
    return newInteraction;
  } catch (error) {
    console.error('Error adding interaction:', error)
    throw new Error('Failed to add interaction')
  }
});

export const getInteractionTypes = withAuth(async (_user, { tenant }): Promise<IInteractionType[]> => {
  try {
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await InteractionModel.getInteractionTypes(tenant);
    });
  } catch (error) {
    console.error('Error fetching interaction types:', error)
    throw new Error('Failed to fetch interaction types')
  }
});

export const getInteractionsForEntity = withAuth(async (
  _user,
  { tenant },
  entityId: string,
  entityType: 'contact' | 'client'
): Promise<IInteraction[]> => {
  try {
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await InteractionModel.getForEntity(entityId, entityType, tenant);
    });
  } catch (error) {
    console.error(`Error fetching interactions for ${entityType}:`, error);
    throw new Error(`Failed to fetch interactions for ${entityType}`);
  }
});

export const getRecentInteractions = withAuth(async (
  _user,
  { tenant },
  filters: {
    userId?: string;
    contactId?: string;
    dateFrom?: Date;
    dateTo?: Date;
    typeId?: string;
  }
): Promise<IInteraction[]> => {
  try {
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await InteractionModel.getRecentInteractions(filters, tenant);
    });
  } catch (error) {
    console.error('Error fetching recent interactions:', error);
    throw new Error('Failed to fetch recent interactions');
  }
});

export const updateInteraction = withAuth(async (
  user,
  { tenant },
  interactionId: string,
  updateData: Partial<IInteraction>
): Promise<IInteraction> => {
  try {
    const { knex } = await createTenantKnex();
    const updatedInteraction = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await InteractionModel.updateInteraction(interactionId, updateData, tenant);
    });
    await publishInteractionSearchEvent('INTERACTION_UPDATED', tenant, interactionId, {
      clientId: updatedInteraction.client_id,
      contactId: updatedInteraction.contact_name_id,
      userId: user?.user_id,
      changedFields: Object.keys(updateData),
    });
    revalidatePath('/msp/interactions/[id]', 'page');
    return updatedInteraction;
  } catch (error) {
    console.error('Error updating interaction:', error);
    throw new Error('Failed to update interaction');
  }
});

export const getInteractionStatuses = withAuth(async (_user, { tenant }): Promise<any[]> => {
  try {
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
});

// Online meetings (and their recording/transcript artifacts) hang off an interaction
// via interaction_id with application-level integrity only (Citus, no FK cascade), so
// they must be cleaned up explicitly when the interaction is deleted — otherwise they
// orphan when a client/contact is removed. Returns stored recording file_ids to delete
// from object storage after the DB transaction commits.
async function cleanupInteractionOnlineMeetings(
  trx: Knex.Transaction,
  tenant: string,
  interactionId: string,
): Promise<string[]> {
  const meetings = await trx('online_meetings')
    .where({ tenant, interaction_id: interactionId })
    .select('meeting_id');
  if (meetings.length === 0) {
    return [];
  }
  const meetingIds = meetings.map((m) => m.meeting_id);

  const artifacts = await trx('online_meeting_artifacts')
    .where({ tenant })
    .whereIn('meeting_id', meetingIds)
    .select('document_id', 'file_id');

  const documentIds = artifacts.map((a) => a.document_id).filter((id): id is string => Boolean(id));
  const fileIds = artifacts.map((a) => a.file_id).filter((id): id is string => Boolean(id));

  await trx('online_meeting_artifacts').where({ tenant }).whereIn('meeting_id', meetingIds).del();
  await trx('online_meetings').where({ tenant }).whereIn('meeting_id', meetingIds).del();

  // Transcript content is stored as internal documents; remove them with the meeting.
  if (documentIds.length > 0) {
    await trx('document_block_content').where({ tenant }).whereIn('document_id', documentIds).del();
    await trx('document_associations').where({ tenant }).whereIn('document_id', documentIds).del();
    await trx('documents').where({ tenant }).whereIn('document_id', documentIds).del();
  }

  return fileIds;
}

export const deleteInteraction = withAuth(async (user, { tenant }, interactionId: string): Promise<void> => {
  try {
    const { knex } = await createTenantKnex();

    const { existing, recordingFileIds } = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const existingRow = await trx('interactions')
        .where({
          interaction_id: interactionId,
          tenant
        })
        .select('interaction_id', 'client_id', 'contact_name_id', 'user_id')
        .first();

      // Cascade-delete the linked online meeting, its artifacts, and transcript documents.
      const fileIds = await cleanupInteractionOnlineMeetings(trx, tenant, interactionId);

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

      return { existing: existingRow, recordingFileIds: fileIds };
    });

    const deletedInteraction = existing;

    // Stored recording blobs live in object storage, not the DB; remove them after commit
    // (best-effort: a storage failure must not roll back the interaction deletion).
    for (const fileId of recordingFileIds) {
      try {
        await StorageService.deleteFile(fileId, user.user_id);
      } catch (storageError) {
        console.warn(`[deleteInteraction] Failed to delete recording file ${fileId}:`, storageError);
      }
    }

    await publishInteractionSearchEvent('INTERACTION_DELETED', tenant, interactionId, {
      clientId: deletedInteraction?.client_id,
      contactId: deletedInteraction?.contact_name_id,
      userId: user?.user_id,
    });

    revalidatePath('/'); // Revalidate to update any cached data
  } catch (error) {
    console.error('Error deleting interaction:', error);
    throw new Error('Failed to delete interaction');
  }
});
