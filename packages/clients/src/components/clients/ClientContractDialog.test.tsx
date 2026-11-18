/* @vitest-environment jsdom */

/**
 * Start-date defaulting for the assignment dialog (alga0002302, finding 2).
 *
 * Creating defaults to the viewer's LOCAL calendar day (not the UTC day that
 * `toISOString()` produced), and editing keeps the stored start date instead of
 * discarding it for "today".
 */

// Pinned before any Date is constructed: 02:30Z is still the previous evening in
// Los Angeles, which is exactly where a UTC "today" goes wrong.
process.env.TZ = 'America/Los_Angeles';

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { dateToString } from '@alga-psa/ui/lib/dateInput';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

// The picker's own behavior is out of scope; expose the Date it receives through
// the same dateToString the dialog uses so the field value is observable.
vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({ id, value }: { id: string; value?: Date }) => (
    <input data-testid={id} readOnly value={value ? dateToString(value) : ''} />
  ),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));

import { ClientContractDialog } from './ClientContractDialog';

const noop = () => undefined;

describe('ClientContractDialog start date', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-26T02:30:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs under the intended ambient timezone', () => {
    expect(new Intl.DateTimeFormat('en').resolvedOptions().timeZone).toBe('America/Los_Angeles');
  });

  it('defaults to the local calendar day on a US-West evening, not the UTC day', () => {
    render(<ClientContractDialog isOpen onContractAssigned={noop} />);

    expect(screen.getByTestId('start-date')).toHaveValue('2026-08-25');
  });

  it('keeps the stored start date when editing, across an effect re-run', () => {
    const { rerender } = render(
      <ClientContractDialog isOpen initialStartDate="2026-03-31" onContractAssigned={noop} />,
    );
    expect(screen.getByTestId('start-date')).toHaveValue('2026-03-31');

    // Closing and re-opening re-runs the reset effect (isOpen is in its deps).
    rerender(<ClientContractDialog isOpen={false} initialStartDate="2026-03-31" onContractAssigned={noop} />);
    rerender(<ClientContractDialog isOpen initialStartDate="2026-03-31" onContractAssigned={noop} />);

    expect(screen.getByTestId('start-date')).toHaveValue('2026-03-31');
  });
});
