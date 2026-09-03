/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import '@testing-library/jest-dom/vitest';

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useUnsavedChangesGuard } from './useUnsavedChangesGuard';

// Integration coverage for the guard composed with the REAL shared Dialog and
// ConfirmationDialog (real Radix close paths), mirroring exactly how the
// template creation dialogs wire it: the confirmation is nested inside the
// guarded Dialog and every dismissal funnels through guard.requestClose.
function GuardedDialogHarness({ onClosed }: { onClosed: () => void }) {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState('');

  const guard = useUnsavedChangesGuard({
    isDirty: draft !== '',
    isOpen: open,
    onClose: () => {
      setOpen(false);
      onClosed();
    },
  });

  return (
    <Dialog isOpen={open} onClose={guard.requestClose} title="Guarded dialog" id="guarded-dialog">
      <DialogContent>
        <label htmlFor="draft-field">Draft</label>
        <input id="draft-field" value={draft} onChange={(e) => setDraft(e.target.value)} />
      </DialogContent>
      <ConfirmationDialog
        id="guarded-discard-confirmation"
        isOpen={guard.isConfirmingClose}
        onClose={guard.keepEditing}
        onConfirm={guard.confirmDiscard}
        title="Discard unsaved template?"
        message="Your template has unsaved changes. If you leave now, those changes will be lost."
        cancelLabel="Keep editing"
        confirmLabel="Discard template"
      />
    </Dialog>
  );
}

const confirmationHeading = () => screen.queryByText('Discard unsaved template?');

describe('useUnsavedChangesGuard with the real Dialog', () => {
  afterEach(() => {
    cleanup();
  });

  it('Escape closes a pristine dialog without a confirmation', async () => {
    const onClosed = vi.fn();
    render(<GuardedDialogHarness onClosed={onClosed} />);

    fireEvent.keyDown(screen.getByLabelText('Draft'), { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    expect(confirmationHeading()).not.toBeInTheDocument();
  });

  it('Escape on a dirty dialog opens the confirmation; Escape on the confirmation returns to editing without cascading', async () => {
    const onClosed = vi.fn();
    render(<GuardedDialogHarness onClosed={onClosed} />);

    const field = screen.getByLabelText('Draft') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'almost finished template' } });

    fireEvent.keyDown(field, { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(confirmationHeading()).toBeInTheDocument());
    expect(onClosed).not.toHaveBeenCalled();

    // The nested confirmation surfaces the safe action and the destructive one.
    const keepEditing = screen.getByRole('button', { name: 'Keep editing' });
    expect(screen.getByRole('button', { name: 'Discard template' })).toBeInTheDocument();

    // Dismissing the confirmation itself must not cascade into closing the
    // underlying dialog.
    fireEvent.keyDown(keepEditing, { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(confirmationHeading()).not.toBeInTheDocument());
    expect(onClosed).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Draft') as HTMLInputElement).value).toBe(
      'almost finished template'
    );
  });

  it('keep editing via the safe action preserves the draft; discard closes', async () => {
    const onClosed = vi.fn();
    render(<GuardedDialogHarness onClosed={onClosed} />);

    const field = screen.getByLabelText('Draft') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'wip' } });
    fireEvent.keyDown(field, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(confirmationHeading()).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(confirmationHeading()).not.toBeInTheDocument());
    expect(onClosed).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Draft') as HTMLInputElement).value).toBe('wip');

    fireEvent.keyDown(screen.getByLabelText('Draft'), { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(confirmationHeading()).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Discard template' }));

    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
  });

  // Note: "clicking a portaled select/menu is not an outside click" cannot be
  // asserted meaningfully under jsdom — Radix's DismissableLayer pointer
  // hit-testing does not fire there (verified: a plain outside pointerdown
  // does not close the real Dialog in jsdom either, so any such assertion
  // would pass vacuously). That protection lives unchanged in the shared
  // Dialog's onInteractOutside handling and is covered by the browser smoke
  // test for this card.
});
