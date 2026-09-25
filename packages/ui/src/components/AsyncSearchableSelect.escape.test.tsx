/** @vitest-environment jsdom */

import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Dialog } from './Dialog';
import AsyncSearchableSelect from './AsyncSearchableSelect';

vi.mock('../ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({ automationIdProps: {}, updateMetadata: vi.fn() }),
}));

if (!('ResizeObserver' in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

function Harness() {
  const [dialogOpen, setDialogOpen] = useState(true);
  return (
    <>
      <Dialog id="escape-test-dialog" title="Escape test" isOpen={dialogOpen} onClose={() => setDialogOpen(false)}>
        <AsyncSearchableSelect
          id="escape-test-select"
          value=""
          onChange={vi.fn()}
          loadOptions={async () => ({ options: [{ value: 'one', label: 'One result' }], total: 1 })}
          debounceMs={0}
        />
      </Dialog>
      {!dialogOpen && <div role="status">Dialog closed</div>}
    </>
  );
}

describe('AsyncSearchableSelect escape ownership', () => {
  it('closes the dropdown first, then lets the dialog close on the next Escape', async () => {
    render(<Harness />);
    const dialog = screen.getByRole('dialog');
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    await screen.findByText('One result');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    fireEvent.keyDown(screen.getByPlaceholderText('Search...'), { key: 'Escape' });
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'));
    expect(screen.getByRole('dialog')).toBe(dialog);

    fireEvent.keyDown(trigger, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status').textContent).toBe('Dialog closed');
  });
});
