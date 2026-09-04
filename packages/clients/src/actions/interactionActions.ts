// @alga-psa/clients/actions.ts

'use server'

import { tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { revalidatePath } from 'next/cache'
import { StorageService } from '@alga-psa/storage/StorageService';
import InteractionModel from '../models/interactions';
import type { InteractionPageFilters, InteractionPageResult } from '../models/interactions';
import { IInteractionType, IInteraction } from '@alga-psa/types'
import { withAuth } from '@alga-psa/auth';
import {
  createInteractionScheduleEntry,
  createInteractionWithSideEffects,
  deleteInteractionScheduleEntries,
  publishInteractionSearchEvent,
  resolveScheduleAssignees,
  syncInteractionScheduleEntries,
} from './interactionCreateHelper';

import { createTenantKnex } from '@alga-psa/db';
import { assertMspPermission, hasPermissionAsync } from '../lib/authHelpers';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

type InteractionActionError = ActionMessageError | ActionPermissionError;

export type { InteractionPageFilters, InteractionPageResult } from '../models/interactions';

function interactionActionErrorFrom(error: unknown): InteractionActionError | null {
  if (error instanceof Error) {
    if (error.message.includes('Permission denied')) {
      return permissionError(error.message);
    }
    if (/unauthorized|not authenticated|must sign in/i.test(error.message)) {
      return permissionError('You must be signed in to manage interactions.', 'msp/clients:errors.interaction.signInRequired');
    }
    if (
      error.message === 'User ID is missing' ||
      error.message === 'Either client_id or contact_name_id must be provided' ||
      error.message === 'No default status found for interactions' ||
      error.message === 'Interactions must be linked to a client' ||
      error.message === 'Interaction not found' ||
      error.message === 'Interaction not found or could not be deleted'
    ) {
      return actionError(error.message);
    }
    // Raised by ScheduleEntry.create when a requested assignee is not in this tenant.
    if (/^Users .+ not found/.test(error.message)) {
      return actionError(
        'One or more assigned users could not be found.',
        'msp/clients:errors.interaction.scheduleUsersMissing',
      );
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the interaction identifiers is invalid. Please refresh and try again.', 'msp/clients:errors.interaction.identifierInvalid');
  }
  if (dbError?.code === '23502') {
    return dbError.column
      ? actionError(
          `Missing required interaction field: ${dbError.column}.`,
          'msp/clients:errors.interaction.missingFieldNamed',
          { field: dbError.column },
        )
      : actionError('Missing required interaction field.', 'msp/clients:errors.interaction.missingField');
  }
  if (dbError?.code === '23503') {
    return actionError('The selected interaction, client, contact, user, status, or type no longer exists. Please refresh and try again.', 'msp/clients:errors.interaction.referenceMissing');
  }
  if (dbError?.code === '23505') {
    return actionError('An interaction with these details already exists.', 'msp/clients:errors.interaction.duplicate');
  }
  return null;
}

export interface AddInteractionOptions {
  /** Also place the interaction on an AlgaPSA calendar. */
  createScheduleEntry?: boolean;
  /** Whose calendar to book. Defaults to the creator; anyone else needs `user_schedule:update`. */
  scheduleAssignedUserIds?: string[];
}

export const addInteraction = withAuth(async (
  user,
  { tenant },
  interactionData: Omit<IInteraction, 'interaction_date'>,
  options: AddInteractionOptions = {}
): Promise<IInteraction | InteractionActionError> => {
  try {
    await assertMspPermission(user, 'interaction', 'create', 'Permission denied: Cannot create interactions');
  } catch (error) {
    const expected = interactionActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }

  try {
    const { knex: db } = await createTenantKnex();

    console.log('Received interaction data:', interactionData);

    if (!interactionData.user_id) {
      throw new Error('User ID is missing');
    }

    if (!interactionData.client_id && !interactionData.contact_name_id) {
      throw new Error('Either client_id or contact_name_id must be provided');
    }

    const scheduleAssignedUserIds = resolveScheduleAssignees(user.user_id, options.scheduleAssignedUserIds);
    if (options.createScheduleEntry && scheduleAssignedUserIds.some((id) => id !== user.user_id)) {
      // Same gate addScheduleEntry applies: booking someone else's calendar is an update
      // of their schedule, not of your own.
      const canAssignOthers = await hasPermissionAsync(user, 'user_schedule', 'update', db);
      if (!canAssignOthers) {
        return permissionError(
          'Permission denied to assign schedule entries to other users.',
          'msp/clients:errors.interaction.scheduleAssignDenied',
        );
      }
    }

    let publishSideEffects: (() => Promise<void>) | undefined;
    let publishScheduleEntryCreated: (() => Promise<void>) | undefined;
    const newInteraction = await withTransaction(db, async (trx: Knex.Transaction) => {
      const result = await createInteractionWithSideEffects({
        tenant,
        trx,
        user,
        interactionData,
      });
      publishSideEffects = result.publishSideEffects;

      if (options.createScheduleEntry) {
        const scheduled = await createInteractionScheduleEntry({
          tenant,
          trx,
          interaction: result.interaction,
          assignedUserIds: scheduleAssignedUserIds,
          assignedByUserId: user.user_id,
        });
        publishScheduleEntryCreated = scheduled?.publishScheduleEntryCreated;
      }

      return result.interaction;
    });

    console.log('New interaction created:', newInteraction);
    await publishSideEffects?.();
    await publishScheduleEntryCreated?.();
    return newInteraction;
  } catch (error) {
    console.error('Error adding interaction:', error)
    const expected = interactionActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const getInteractionTypes = withAuth(async (user, { tenant }): Promise<IInteractionType[] | InteractionActionError> => {
  try {
    await assertMspPermission(user, 'interaction', 'read', 'Permission denied: Cannot read interaction types');

    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await InteractionModel.getInteractionTypes(tenant);
    });
  } catch (error) {
    const expected = interactionActionErrorFrom(error);
    if (expected) return expected;
    console.error('Error fetching interaction types:', error);
    throw error;
  }
});

export const getInteractionsForEntity = withAuth(async (
  user,
  { tenant },
  entityId: string,
  entityType: 'contact' | 'client' | 'ticket'
): Promise<IInteraction[] | InteractionActionError> => {
  try {
    await assertMspPermission(user, 'interaction', 'read', 'Permission denied: Cannot read interactions');

    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await InteractionModel.getForEntity(entityId, entityType, tenant);
    });
  } catch (error) {
    const expected = interactionActionErrorFrom(error);
    if (expected) return expected;
    console.error(`Error fetching interactions for ${entityType}:`, error);
    throw error;
  }
});

export const getRecentInteractions = withAuth(async (
  user,
  { tenant },
  filters: {
    userId?: string;
    contactId?: string;
    dateFrom?: Date;
    dateTo?: Date;
    typeId?: string;
  }
): Promise<IInteraction[] | InteractionActionError> => {
  try {
    await assertMspPermission(user, 'interaction', 'read', 'Permission denied: Cannot read interactions');

    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await InteractionModel.getRecentInteractions(filters, tenant);
    });
  } catch (error) {
    const expected = interactionActionErrorFrom(error);
    if (expected) return expected;
    console.error('Error fetching recent interactions:', error);
    throw error;
  }
});

export const getInteractionsPage = withAuth(async (
  user,
  { tenant },
  filters: InteractionPageFilters,
): Promise<InteractionPageResult | InteractionActionError> => {
  try {
    await assertMspPermission(user, 'interaction', 'read', 'Permission denied: Cannot read interactions');

    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      return InteractionModel.getInteractionsPage(filters, tenant, trx);
    });
  } catch (error) {
    const expected = interactionActionErrorFrom(error);
    if (expected) return expected;
    console.error('Error fetching interactions page:', error);
    throw error;
  }
});

export const updateInteraction = withAuth(async (
  user,
  { tenant },
  interactionId: string,
  updateData: Partial<IInteraction>
): Promise<IInteraction | InteractionActionError> => {
  try {
    await assertMspPermission(user, 'interaction', 'update', 'Permission denied: Cannot update interactions');
  } catch (error) {
    const expected = interactionActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }

  try {
    const { knex } = await createTenantKnex();
    const touchesScheduleEntry = (['start_time', 'end_time', 'duration', 'title'] as const)
      .some((field) => updateData[field] !== undefined);
    const updatedInteraction = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const interaction = await InteractionModel.updateInteraction(interactionId, updateData, tenant);
      // Keep the calendar block in step with the interaction it represents.
      if (touchesScheduleEntry) {
        await syncInteractionScheduleEntries(trx, tenant, interaction);
      }
      return interaction;
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
    const expected = interactionActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const getInteractionStatuses = withAuth(async (user, { tenant }): Promise<any[] | InteractionActionError> => {
  try {
    await assertMspPermission(user, 'interaction', 'read', 'Permission denied: Cannot read interaction statuses');

    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table('statuses')
        .where({
          status_type: 'interaction'
        })
        .select('*')
        .orderBy('order_number');
    });
  } catch (error) {
    const expected = interactionActionErrorFrom(error);
    if (expected) return expected;
    console.error('Error fetching interaction statuses:', error);
    throw error;
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
  const db = tenantDb(trx, tenant);

  const meetings = await db.table('online_meetings')
    .where({ interaction_id: interactionId })
    .select('meeting_id');
  if (meetings.length === 0) {
    return [];
  }
  const meetingIds = meetings.map((m) => m.meeting_id);

  const artifacts = await db.table('online_meeting_artifacts')
    .whereIn('meeting_id', meetingIds)
    .select('document_id', 'file_id');

  const documentIds = artifacts.map((a) => a.document_id).filter((id): id is string => Boolean(id));
  const fileIds = artifacts.map((a) => a.file_id).filter((id): id is string => Boolean(id));

  await db.table('online_meeting_artifacts').whereIn('meeting_id', meetingIds).del();
  await db.table('online_meetings').whereIn('meeting_id', meetingIds).del();

  // Transcript content is stored as internal documents; remove them with the meeting.
  if (documentIds.length > 0) {
    await db.table('document_block_content').whereIn('document_id', documentIds).del();
    await db.table('document_associations').whereIn('document_id', documentIds).del();
    await db.table('documents').whereIn('document_id', documentIds).del();
  }

  return fileIds;
}

export const deleteInteraction = withAuth(async (user, { tenant }, interactionId: string): Promise<void | InteractionActionError> => {
  try {
    await assertMspPermission(user, 'interaction', 'delete', 'Permission denied: Cannot delete interactions');
  } catch (error) {
    const expected = interactionActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }

  try {
    const { knex } = await createTenantKnex();

    const { existing, recordingFileIds } = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenant);

      const existingRow = await db.table('interactions')
        .where({
          interaction_id: interactionId,
        })
        .select('interaction_id', 'client_id', 'contact_name_id', 'user_id')
        .first();

      // Cascade-delete the linked online meeting, its artifacts, and transcript documents.
      const fileIds = await cleanupInteractionOnlineMeetings(trx, tenant, interactionId);

      // ...and the calendar block the interaction put on the assignees' schedule.
      await deleteInteractionScheduleEntries(trx, tenant, interactionId);

      // Delete the interaction
      const deletedCount = await db.table('interactions')
        .where({
          interaction_id: interactionId,
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
    const expected = interactionActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});
