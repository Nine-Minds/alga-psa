/** @vitest-environment jsdom */

import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dialog, DialogContent } from '../components/Dialog';

afterEach(() => {
  cleanup();
});

function DialogHarness({ onSubmit }: { onSubmit: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open create
      </button>
      <Dialog isOpen={open} onClose={() => setOpen(false)} title="Create item" id="create-dialog">
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            <label htmlFor="name">Name</label>
            <input id="name" />
            <label htmlFor="notes">Notes</label>
            <textarea id="notes" />
            <button type="submit">Create</button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe('create dialog keyboard accessibility', () => {
  it('focuses the first field on open and restores focus to the invoker on close', async () => {
    const onSubmit = vi.fn();
    render(<DialogHarness onSubmit={onSubmit} />);

    const opener = screen.getByRole('button', { name: 'Open create' });
    opener.focus();
    fireEvent.click(opener);

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText('Name'));
    });

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });

    await waitFor(() => {
      expect(document.activeElement).toBe(opener);
    });
  });

  it('submits the dialog form with mod+Enter from a textarea', async () => {
    const onSubmit = vi.fn();
    render(<DialogHarness onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open create' }));
    const textarea = await screen.findByLabelText('Notes');
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
