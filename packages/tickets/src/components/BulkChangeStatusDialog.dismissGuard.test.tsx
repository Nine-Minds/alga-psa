/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

// Uses the REAL shared Dialog so the dismiss guard it owns is what is under test.

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

async function openWithResolution(text?: string) {
  const onClose = vi.fn();
  render(
    <BulkChangeStatusDialog
      isOpen
      onClose={onClose}
      ticketCount={2}
      ticketIds={['ticket-1', 'ticket-2']}
      statuses={STATUSES}
      closedStatusIds={['closed']}
      resolutionRequired
      isLoadingStatuses={false}
      failed={[]}
      isSubmitting={false}
      onConfirm={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'closed' } });
  const field = (await screen.findByLabelText('Resolution comment')) as HTMLTextAreaElement;
  if (text !== undefined) fireEvent.change(field, { target: { value: text } });
  return { onClose, field };
}

const question = () => screen.queryByText('Discard unsaved changes?');

describe('BulkChangeStatusDialog unsaved resolution guard (real Dialog)', () => {
  it('T4: Escape with typed text asks instead of closing; Keep editing leaves the text', async () => {
    const { onClose, field } = await openWithResolution('Replaced the switch');

    fireEvent.keyDown(field, { key: 'Escape' });

    expect(await screen.findByText('Discard unsaved changes?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(question()).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Resolution comment') as HTMLTextAreaElement).value).toBe('Replaced the switch');
  });

  // Radix registers its outside-pointerdown listener in a setTimeout(0), so flush it first.
  const clickOutside = async () => {
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    fireEvent.pointerDown(document.body);
  };

  it('T5 control: an outside click closes a pristine dialog (proves jsdom drives Radix here)', async () => {
    const { onClose } = await openWithResolution();

    await clickOutside();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('T5: an outside click with typed text does not close, and the text stays', async () => {
    const { onClose } = await openWithResolution('Replaced the switch');

    await clickOutside();

    expect(await screen.findByText('Discard unsaved changes?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Resolution comment') as HTMLTextAreaElement).value).toBe('Replaced the switch');
  });

  it('T6: Escape with no text closes immediately without asking', async () => {
    const { onClose, field } = await openWithResolution();

    fireEvent.keyDown(field, { key: 'Escape' });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(question()).toBeNull();
  });
});
