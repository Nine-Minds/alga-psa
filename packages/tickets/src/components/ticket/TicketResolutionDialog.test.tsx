/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import TicketResolutionDialog from './TicketResolutionDialog';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({
    id,
    label,
    value,
    options,
    onValueChange,
    disabled,
  }: {
    id: string;
    label: string;
    value: string | null;
    options: { value: string; label: string }[];
    onValueChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <label>
      {label}
      <select
        id={id}
        value={value ?? ''}
        onChange={(event) => onValueChange(event.target.value)}
        disabled={disabled}
      >
        <option value="">Select a close status</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  ),
}));

describe('TicketResolutionDialog', () => {
  it('requires a close status and non-empty resolution, then submits both', () => {
    const onConfirm = vi.fn();

    render(
      <TicketResolutionDialog
        id="ticket-resolution-close"
        isOpen
        statusOptions={[
          { value: 'resolved', label: 'Resolved' },
          { value: 'closed', label: 'Closed' },
        ]}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText('Choose a close status and add a resolution for this ticket.')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Resolve and close' });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Resolution'), { target: { value: '  Replaced the failed switch.  ' } });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Close status'), { target: { value: 'resolved' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledWith('resolved', 'Replaced the failed switch.');
  });

  it('resets the draft and status choice whenever the dialog is opened again', () => {
    const props = {
      id: 'ticket-resolution-close',
      statusOptions: [
        { value: 'resolved', label: 'Resolved' },
        { value: 'closed', label: 'Closed' },
      ],
      onClose: vi.fn(),
      onConfirm: vi.fn(),
    };
    const { rerender } = render(<TicketResolutionDialog {...props} isOpen />);

    fireEvent.change(screen.getByLabelText('Close status'), { target: { value: 'closed' } });
    fireEvent.change(screen.getByLabelText('Resolution'), { target: { value: 'Temporary draft' } });
    rerender(<TicketResolutionDialog {...props} isOpen={false} />);
    rerender(<TicketResolutionDialog {...props} isOpen />);

    expect(screen.getByLabelText('Close status')).toHaveValue('');
    expect(screen.getByLabelText('Resolution')).toHaveValue('');
  });

  it('preselects the only available close status', () => {
    render(
      <TicketResolutionDialog
        id="ticket-resolution-close"
        isOpen
        statusOptions={[{ value: 'closed', label: 'Closed' }]}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Close status')).toHaveValue('closed');
  });
});
