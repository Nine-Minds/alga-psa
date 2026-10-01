/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../actions/ticketBundleActions', () => ({
  previewBulkBundleStatusPropagationAction: vi.fn().mockResolvedValue({}),
}));

const { translate } = vi.hoisted(() => ({
  translate: (key: string, fallback?: string | Record<string, unknown>) => {
    const template = typeof fallback === 'string' ? fallback : (fallback?.defaultValue as string | undefined);
    if (typeof template !== 'string') return key;
    const values = typeof fallback === 'string' ? undefined : fallback;
    return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? `{{${name}}}`));
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

// The dialog renders TicketNotificationSuppressionControl, which translates via
// the UI package's wrapper rather than react-i18next directly.
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// The real Radix switch needs ResizeObserver, which jsdom lacks; this keeps the
// suite on the resolution-flag behavior rather than the design system.
vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({ id, checked, onCheckedChange, disabled }: {
    id: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    disabled?: boolean;
  }) => (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, options, onValueChange, disabled }: {
    id: string;
    value: string;
    options: { value: string; label: string }[];
    onValueChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select
      id={id}
      aria-label="Status"
      value={value ?? ''}
      onChange={(event) => onValueChange(event.target.value)}
      disabled={disabled}
    >
      <option value="">Select a status</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

import BulkChangeStatusDialog from './BulkChangeStatusDialog';

const STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
];

function renderDialog(onConfirm = vi.fn().mockResolvedValue(undefined)) {
  render(
    <BulkChangeStatusDialog
      isOpen
      onClose={vi.fn()}
      ticketCount={2}
      ticketIds={['ticket-1', 'ticket-2']}
      statuses={STATUSES}
      closedStatusIds={['closed']}
      isLoadingStatuses={false}
      failed={[]}
      isSubmitting={false}
      onConfirm={onConfirm}
    />,
  );
  return onConfirm;
}

const RESOLUTION_LABEL = 'Resolution comment (optional)';

describe('BulkChangeStatusDialog resolution comment', () => {
  it('offers the resolution field only for a closing status', async () => {
    renderDialog();

    expect(screen.queryByLabelText(RESOLUTION_LABEL)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'open' } });
    expect(screen.queryByLabelText(RESOLUTION_LABEL)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'closed' } });
    expect(await screen.findByLabelText(RESOLUTION_LABEL)).toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('submits a trimmed internal resolution alongside the closing status', async () => {
    const onConfirm = renderDialog();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'closed' } });
    fireEvent.change(await screen.findByLabelText(RESOLUTION_LABEL), {
      target: { value: '  Replaced the failed switch.  ' },
    });
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: 'Update 2 Tickets' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('closed', {
      resolutionComment: { text: 'Replaced the failed switch.', isInternal: true },
    }));
  });

  it('omits the resolution when it is blank or the status no longer closes', async () => {
    const onConfirm = renderDialog();
    const confirm = () => screen.getByRole('button', { name: 'Update 2 Tickets' });

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'closed' } });
    fireEvent.change(await screen.findByLabelText(RESOLUTION_LABEL), { target: { value: '   ' } });
    await waitFor(() => expect(confirm()).toBeEnabled());
    fireEvent.click(confirm());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('closed'));

    onConfirm.mockClear();
    fireEvent.change(screen.getByLabelText(RESOLUTION_LABEL), { target: { value: 'Fixed' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'open' } });
    expect(screen.queryByLabelText(RESOLUTION_LABEL)).not.toBeInTheDocument();
    await waitFor(() => expect(confirm()).toBeEnabled());
    fireEvent.click(confirm());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('open'));
  });
});
