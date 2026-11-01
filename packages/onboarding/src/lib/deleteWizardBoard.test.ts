import { describe, expect, it, vi } from 'vitest';
import { deleteWizardBoard } from './deleteWizardBoard';

const statuses = { success: false, code: 'BOARD_HAS_STATUSES', message: 'Board has 4 statuses', dependencies: ['statuses'], counts: { statuses: 4 } };
const denied = { success: false, code: 'PERMISSION_DENIED', message: 'Permission denied: Cannot delete boards' };

describe('deleteWizardBoard', () => {
  it('deletes a board that has statuses by confirming the cleanup with force', async () => {
    const deleteBoard = vi.fn()
      .mockResolvedValueOnce(statuses)
      .mockResolvedValueOnce({ success: true });
    const result = await deleteWizardBoard('b1', deleteBoard);
    expect(deleteBoard.mock.calls).toEqual([['b1', false], ['b1', true]]);
    expect(result).toMatchObject({ success: true, canDelete: true });
  });

  it('reports a permission refusal and never retries with force', async () => {
    const deleteBoard = vi.fn().mockResolvedValue(denied);
    const result = await deleteWizardBoard('b1', deleteBoard);
    expect(deleteBoard).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: false, canDelete: false, code: 'PERMISSION_DENIED' });
  });

  it('does not force through categories the user was not shown', async () => {
    const deleteBoard = vi.fn().mockResolvedValue({
      success: false, code: 'BOARD_HAS_CATEGORIES', message: 'Board has 2 categories', dependencies: ['categories'], counts: { categories: 2 },
    });
    const result = await deleteWizardBoard('b1', deleteBoard);
    expect(deleteBoard).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: false, code: 'DEPENDENCIES_EXIST', dependencies: [{ type: 'categories', count: 2 }] });
  });
});
