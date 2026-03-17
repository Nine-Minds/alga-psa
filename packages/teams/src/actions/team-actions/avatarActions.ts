'use server';

import Team from '../../models/team';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { uploadEntityImage, deleteEntityImage } from '@alga-psa/storage';
import { getTeamAvatarUrl } from '@alga-psa/formatting/avatarUtils';
import type { Knex } from 'knex';

interface ActionResult {
  success: boolean;
  message?: string;
  error?: string;
}

export const uploadTeamAvatar = withAuth(async (
  currentUser,
  { tenant },
  teamId: string,
  formData: FormData
): Promise<ActionResult & { avatarUrl?: string | null }> => {
  try {
    const { knex } = await createTenantKnex();
    const team = await Team.get(knex, tenant, teamId);

    if (!team) {
      return { success: false, error: 'Team not found.' };
    }

    const canUpdate = await hasPermission(currentUser, 'user_settings', 'update', knex);
    if (!canUpdate) {
      return { success: false, error: 'Permission denied: cannot update team avatar.' };
    }

    const file = formData.get('avatar') as File | null;
    if (!file) {
      return { success: false, error: 'No avatar file provided.' };
    }

    if (file.size === 0) {
      return { success: false, error: 'Avatar file cannot be empty.' };
    }

    const uploadResult = await uploadEntityImage(
      'team',
      teamId,
      file,
      currentUser.user_id,
      tenant,
      'team_avatar',
      true
    );

    if (!uploadResult.success) {
      return { success: false, error: uploadResult.message || 'Failed to upload avatar.' };
    }

    return {
      success: true,
      message: 'Avatar uploaded successfully.',
      avatarUrl: uploadResult.imageUrl
    };
  } catch (error: any) {
    console.error('[TeamAvatarActions] Failed to upload team avatar:', {
      operation: 'uploadTeamAvatar',
      teamId,
      errorMessage: error?.message || 'Unknown error',
      errorStack: error?.stack,
      errorName: error?.name
    });
    return { success: false, error: error?.message || 'An unexpected error occurred while uploading the avatar.' };
  }
});

export const deleteTeamAvatar = withAuth(async (
  currentUser,
  { tenant },
  teamId: string
): Promise<ActionResult> => {
  try {
    const { knex } = await createTenantKnex();
    const team = await Team.get(knex, tenant, teamId);

    if (!team) {
      return { success: false, error: 'Team not found.' };
    }

    const canUpdate = await hasPermission(currentUser, 'user_settings', 'update', knex);
    if (!canUpdate) {
      return { success: false, error: 'Permission denied: cannot update team avatar.' };
    }

    const deleteResult = await deleteEntityImage(
      'team',
      teamId,
      currentUser.user_id,
      tenant
    );

    if (!deleteResult.success) {
      return { success: false, error: deleteResult.message || 'Failed to delete avatar.' };
    }

    return { success: true, message: deleteResult.message || 'Avatar deleted successfully.' };
  } catch (error: any) {
    console.error('[TeamAvatarActions] Failed to delete team avatar:', {
      operation: 'deleteTeamAvatar',
      teamId,
      errorMessage: error?.message || 'Unknown error',
      errorStack: error?.stack,
      errorName: error?.name
    });
    return { success: false, error: error?.message || 'An unexpected error occurred while deleting the avatar.' };
  }
});

export async function getTeamAvatarUrlAction(teamId: string, tenant: string): Promise<string | null> {
  return getTeamAvatarUrl(teamId, tenant);
}

async function getTeamAvatarUrlsBatch(
  teamIds: string[],
  tenant: string
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  teamIds.forEach((id) => result.set(id, null));

  if (teamIds.length === 0) {
    return result;
  }

  try {
    const { knex } = await createTenantKnex(tenant);
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const associations = await trx('document_associations')
        .select('entity_id', 'document_id')
        .whereIn('entity_id', teamIds)
        .andWhere({
          entity_type: 'team',
          is_entity_logo: true,
          tenant,
        });

      if (associations.length === 0) {
        return result;
      }

      const documentIds = associations.map((a: any) => a.document_id);
      const documents = await trx('documents')
        .select('document_id', 'file_id', 'updated_at')
        .whereIn('document_id', documentIds)
        .andWhere({ tenant });

      const docToInfo = new Map(
        documents.map((d: any) => [
          d.document_id,
          { file_id: d.file_id as string | null, updated_at: d.updated_at as Date | null },
        ])
      );

      const fileIds = documents.map((d: any) => d.file_id).filter(Boolean);
      const imageFileIds = new Set<string>();
      if (fileIds.length > 0) {
        const files = await trx('external_files')
          .select('file_id', 'mime_type')
          .whereIn('file_id', fileIds)
          .andWhere({ tenant });
        for (const file of files) {
          if (file?.mime_type?.startsWith('image/')) {
            imageFileIds.add(file.file_id);
          }
        }
      }

      for (const association of associations) {
        const docInfo = docToInfo.get(association.document_id);
        const fileId = docInfo?.file_id;
        if (!fileId || !imageFileIds.has(fileId)) {
          continue;
        }
        const baseUrl = `/api/documents/view/${fileId}`;
        const timestamp = docInfo?.updated_at ? new Date(docInfo.updated_at).getTime() : 0;
        result.set(association.entity_id, `${baseUrl}?t=${timestamp}`);
      }

      return result;
    });
  } catch {
    return result;
  }
}

export async function getTeamAvatarUrlsBatchAction(
  teamIds: string[],
  tenant: string
): Promise<Map<string, string | null>> {
  return getTeamAvatarUrlsBatch(teamIds, tenant);
}
