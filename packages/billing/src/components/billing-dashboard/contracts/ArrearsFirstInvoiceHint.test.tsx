// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeAnchorSettingsForCycle } from '@alga-psa/shared/billingClients/billingCycleAnchors';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const fallback = (options?.defaultValue as string) ?? key;
      return fallback.replace(/{{(\w+)}}/g, (_match, token) => String(options?.[token] ?? ''));
    },
  }),
  useFormatters: () => ({
    formatDate: (value: Date) =>
      `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`,
  }),
}));

const { ArrearsFirstInvoiceHint } = await import('./ArrearsFirstInvoiceHint');

const schedule = { billingCycle: 'monthly' as const, anchor: normalizeAnchorSettingsForCycle('monthly', {}) };
const props = {
  id: 'hint',
  lineType: 'Fixed',
  cadenceOwner: 'client' as const,
  billingTiming: 'arrears' as const,
  startDate: '2026-10-20',
  clientSchedule: schedule,
};

describe('ArrearsFirstInvoiceHint', () => {
  afterEach(() => cleanup());

  it('renders the formatted invoice date, inclusive covered dates and advance date', () => {
    render(<ArrearsFirstInvoiceHint {...props} />);
    expect(document.getElementById('hint')!.textContent).toBe(
      'First invoice: the 2026-11-01 invoice covers 2026-10-20 – 2026-10-31 (billed in arrears). Choose In Advance to bill it on the invoice for the period starting 2026-10-01.',
    );
    expect(document.getElementById('hint-bill-in-advance')).toBeNull();
  });

  it('the button calls onBillInAdvance', () => {
    const onBillInAdvance = vi.fn();
    render(<ArrearsFirstInvoiceHint {...props} onBillInAdvance={onBillInAdvance} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bill in advance' }));
    expect(onBillInAdvance).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['advance timing', { billingTiming: 'advance' as const }],
    ['contract cadence', { cadenceOwner: 'contract' as const }],
    ['aligned start', { startDate: '2026-10-01' }],
    ['Hourly line', { lineType: 'Hourly' }],
    ['schedule loading or failed', { clientSchedule: null }],
    ['invoice date reached (today passed)', { today: new Date(2026, 10, 2) }],
  ])('renders nothing for %s', (_label, override) => {
    const { container } = render(<ArrearsFirstInvoiceHint {...props} {...override} />);
    expect(container.innerHTML).toBe('');
  });
});
