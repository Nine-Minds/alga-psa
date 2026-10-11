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
  Dialog: ({ children, hasUnsavedChanges }: { children: React.ReactNode; hasUnsavedChanges?: boolean }) => (
    <div data-testid="dialog" data-has-unsaved-changes={String(!!hasUnsavedChanges)}>{children}</div>
  ),
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

function renderDialog(onConfirm = vi.fn().mockResolvedValue(undefined), resolutionRequired?: boolean) {
  render(
    <BulkChangeStatusDialog
      isOpen
      onClose={vi.fn()}
      ticketCount={2}
      ticketIds={['ticket-1', 'ticket-2']}
      statuses={STATUSES}
      closedStatusIds={['closed']}
      resolutionRequired={resolutionRequired}
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

  describe('when the board requires a resolution', () => {
    const REQUIRED_LABEL = 'Resolution comment';
    const HINT = 'This board requires a resolution comment before tickets can be closed.';
    const confirm = () => screen.getByRole('button', { name: 'Update 2 Tickets' });

    it('T1: labels the field required, shows the hint and gates Confirm on trimmed text', async () => {
      const onConfirm = renderDialog(undefined, true);

      fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'closed' } });
      const field = await screen.findByLabelText(REQUIRED_LABEL);
      expect(screen.queryByLabelText(RESOLUTION_LABEL)).not.toBeInTheDocument();
      expect(field).toHaveAttribute('aria-required', 'true');
      expect(field).toBeRequired();
      expect(screen.getByText(HINT)).toBeInTheDocument();
      expect(field).toHaveAttribute('aria-describedby', screen.getByText(HINT).id);
      expect(screen.queryByText(/satisfying boards that require one/)).not.toBeInTheDocument();
      expect(confirm()).toBeDisabled();

      fireEvent.change(field, { target: { value: '   ' } });
      expect(confirm()).toBeDisabled();

      fireEvent.change(field, { target: { value: '  Swapped the switch.  ' } });
      expect(confirm()).toBeEnabled();
      fireEvent.click(confirm());
      await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('closed', {
        resolutionComment: { text: 'Swapped the switch.', isInternal: false },
      }));
    });

    it('T2: a non-closing status has no field and Confirm works once chosen', async () => {
      const onConfirm = renderDialog(undefined, true);

      fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'open' } });
      expect(screen.queryByLabelText(REQUIRED_LABEL)).not.toBeInTheDocument();
      expect(screen.queryByText(HINT)).not.toBeInTheDocument();
      await waitFor(() => expect(confirm()).toBeEnabled());
      fireEvent.click(confirm());
      await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('open'));
    });
  });

  it('T3: an optional board keeps the optional label and helper, and Confirm needs no text', async () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'closed' } });
    const field = await screen.findByLabelText(RESOLUTION_LABEL);
    expect(field).not.toHaveAttribute('aria-required');
    expect(screen.getByText(/satisfying boards that require one/)).toBeInTheDocument();
    expect(screen.queryByText(/This board requires a resolution comment/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update 2 Tickets' })).toBeEnabled());
  });

  it('flags the dialog as having unsaved changes only while resolution text is present', async () => {
    renderDialog();
    const dialog = screen.getByTestId('dialog');
    expect(dialog).toHaveAttribute('data-has-unsaved-changes', 'false');

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'closed' } });
    const field = await screen.findByLabelText(RESOLUTION_LABEL);
    fireEvent.change(field, { target: { value: '   ' } });
    expect(dialog).toHaveAttribute('data-has-unsaved-changes', 'false');
    fireEvent.change(field, { target: { value: 'Fixed' } });
    expect(dialog).toHaveAttribute('data-has-unsaved-changes', 'true');
  });
});
