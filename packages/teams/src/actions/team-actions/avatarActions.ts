'use server';

import Team from '../../models/team';
import { createTenantKnex } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { uploadEntityImage, deleteEntityImage, getTeamAvatarUrl } from '@alga-psa/media';

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

    const canUpdate = await hasPermission(currentUser, 'team', 'update', knex);
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

    const canUpdate = await hasPermission(currentUser, 'team', 'update', knex);
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
