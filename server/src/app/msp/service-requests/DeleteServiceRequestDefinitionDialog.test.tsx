// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeletionValidationResult } from '@alga-psa/types';
import { DeleteServiceRequestDefinitionDialog } from './DeleteServiceRequestDefinitionDialog';

const mocks = vi.hoisted(() => ({
  preCheck: vi.fn(),
  deleteAction: vi.fn(),
  archiveAction: vi.fn(),
}));

vi.mock('@alga-psa/auth/lib/preCheckDeletion', () => ({ preCheckDeletion: mocks.preCheck }));
vi.mock('./actions', () => ({
  deleteServiceRequestDefinitionAction: mocks.deleteAction,
  archiveServiceRequestDefinitionAction: mocks.archiveAction,
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; entityName?: string; name?: string }) => {
      if (key === 'deleteDialog.confirmation') return `Permanently remove ${options?.name}`;
      const defaults: Record<string, string> = {
        'actions.delete': 'Delete',
        'actions.cancel': 'Cancel',
      };
      return defaults[key] ?? options?.defaultValue?.replace('{{entityName}}', options?.entityName ?? '') ?? key;
    },
  }),
}));

const blocked: DeletionValidationResult = {
  canDelete: false,
  code: 'DEPENDENCIES_EXIST',
  message: 'Has submissions',
  dependencies: [{ type: 'submission', count: 3, label: 'submissions' }],
  alternatives: [{ action: 'archive', label: 'Archive' }],
};
const allowed: DeletionValidationResult = { canDelete: true, dependencies: [], alternatives: [] };

const draft = { definition_id: 'def-1', name: 'Laptop Request', lifecycle_state: 'draft' as const };
const archived = { ...draft, lifecycle_state: 'archived' as const };

function renderDialog(definition: typeof draft | typeof archived) {
  const onDeleted = vi.fn();
  const onArchived = vi.fn();
  const onClose = vi.fn();
  render(
    <DeleteServiceRequestDefinitionDialog
      definition={definition}
      onClose={onClose}
      onDeleted={onDeleted}
      onArchived={onArchived}
    />
  );
  return { onDeleted, onArchived, onClose };
}

describe('DeleteServiceRequestDefinitionDialog', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
  });

  it('validates on open and hides Archive for an already-archived blocked form', async () => {
    mocks.preCheck.mockResolvedValue(blocked);
    renderDialog(archived);

    await waitFor(() => expect(screen.getByText(/3 submissions/)).toBeTruthy());
    expect(mocks.preCheck).toHaveBeenCalledWith('service_request_definition', 'def-1');
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
  });

  it('offers Archive for a blocked draft form and calls the archive action', async () => {
    mocks.preCheck.mockResolvedValue(blocked);
    mocks.archiveAction.mockResolvedValue({ success: true, data: undefined });
    const { onArchived } = renderDialog(draft);

    const archiveButton = await screen.findByRole('button', { name: 'Archive' });
    fireEvent.click(archiveButton);

    await waitFor(() => expect(mocks.archiveAction).toHaveBeenCalledWith('def-1'));
    await waitFor(() => expect(onArchived).toHaveBeenCalled());
  });

  it('confirm calls the delete action and fires onDeleted', async () => {
    mocks.preCheck.mockResolvedValue(allowed);
    mocks.deleteAction.mockResolvedValue({ ...allowed, deleted: true });
    const { onDeleted } = renderDialog(draft);

    expect(await screen.findByText('Permanently remove Laptop Request')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mocks.deleteAction).toHaveBeenCalledWith('def-1'));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });
});
