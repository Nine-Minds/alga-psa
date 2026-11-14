import type { DeletionValidationResult } from '@alga-psa/types';

type DeleteBoardFn = (
  boardId: string,
  force?: boolean,
  cleanupItil?: boolean
) => Promise<{
  success: boolean;
  code?: string;
  message?: string;
  dependencies?: string[];
  counts?: Record<string, number>;
}>;

export type WizardBoardDeleteResult = DeletionValidationResult & { success: boolean };

/**
 * Delete a board from the Setup wizard through deleteBoard, which runs the
 * board mutation guard (internal principal + ticket_settings:delete) and
 * cleans up the board's statuses and dependent rows. The generic
 * reference-data delete did neither: it failed on statuses_tenant_board_id_fk
 * for any board with statuses, and performed no authorization.
 *
 * The wizard has already put the board in front of the user in a delete
 * confirmation, so the "this board also owns statuses, delete them too?" step
 * (BOARD_HAS_STATUSES) is answered by retrying with force. Any other outcome
 * (categories that would go too, last ITIL board, permission denied, in-use
 * blockers) is reported back untouched rather than deleting more than the user
 * was shown.
 */
export async function deleteWizardBoard(
  boardId: string,
  deleteBoard: DeleteBoardFn
): Promise<WizardBoardDeleteResult> {
  let result = await deleteBoard(boardId, false);
  if (!result.success && result.code === 'BOARD_HAS_STATUSES') {
    result = await deleteBoard(boardId, true);
  }

  if (result.success) {
    return { success: true, canDelete: true, dependencies: [], alternatives: [] };
  }

  return {
    success: false,
    canDelete: false,
    code:
      result.code === 'PERMISSION_DENIED' ? 'PERMISSION_DENIED'
      : result.code === 'NOT_FOUND' ? 'NOT_FOUND'
      : result.code === 'BOARD_IS_DEFAULT' ? 'IS_DEFAULT'
      : 'DEPENDENCIES_EXIST',
    message: result.message,
    dependencies: (result.dependencies ?? []).map((type) => ({
      type,
      count: result.counts?.[type] ?? 0,
      label: type.replace(/_/g, ' '),
    })),
    alternatives: [],
  };
}
