/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import TicketResolutionDialog from './TicketResolutionDialog';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, values?: Record<string, string>) =>
      (fallback ?? _key).replace('{{status}}', values?.status ?? ''),
  }),
}));

describe('TicketResolutionDialog', () => {
  it('requires a non-empty resolution and submits trimmed text', () => {
    const onConfirm = vi.fn();

    render(
      <TicketResolutionDialog
        id="ticket-resolution-close"
        isOpen
        statusLabel="Closed"
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText('Add a resolution before moving this ticket to Closed.')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Resolve and close' });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Resolution'), { target: { value: '  Replaced the failed switch.  ' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledWith('Replaced the failed switch.');
  });

  it('resets the draft whenever the dialog is opened again', () => {
    const props = {
      id: 'ticket-resolution-close',
      statusLabel: 'Closed',
      onClose: vi.fn(),
      onConfirm: vi.fn(),
    };
    const { rerender } = render(<TicketResolutionDialog {...props} isOpen />);

    fireEvent.change(screen.getByLabelText('Resolution'), { target: { value: 'Temporary draft' } });
    rerender(<TicketResolutionDialog {...props} isOpen={false} />);
    rerender(<TicketResolutionDialog {...props} isOpen />);

    expect(screen.getByLabelText('Resolution')).toHaveValue('');
  });
});
