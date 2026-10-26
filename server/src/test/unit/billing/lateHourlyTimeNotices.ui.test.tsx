/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ILateHourlyTimeNotice } from '@alga-psa/types';

const interpolate = (text: string, values: Record<string, unknown> = {}) => text.replace(/\{\{(\w+)\}\}/g, (_, k) => String(values[k] ?? ''));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, options: any = {}) => interpolate(options.defaultValue ?? _key, options) }),
  useFormatters: () => ({ formatDate: (value: Date) => value.toISOString().slice(0, 10) }),
}));
import { LateHourlyTimeNotices } from '../../../../../packages/billing/src/components/billing-dashboard/LateHourlyTimeNotices';

afterEach(cleanup);
const notice = (over: Partial<ILateHourlyTimeNotice> = {}): ILateHourlyTimeNotice => ({
  entryId: '11111111-1111-4111-8111-111111111111', clientId: '22222222-2222-4222-8222-222222222222', clientName: 'White Rabbit',
  contractLineId: '33333333-3333-4333-8333-333333333333', contractLineName: 'Hourly support', serviceName: 'Basic Support',
  workItemLabel: '#000016 Printer queue', technicianName: 'QA Tester', workDate: '2026-10-18', billableMinutes: 30,
  closedPeriodStart: '2026-10-01', closedPeriodEnd: '2026-10-31', closedByInvoiceNumber: 'INV-000003', closedByInvoiceStatus: 'sent',
  disposition: 'no_later_period', ...over,
});

describe('late approved hourly time notices', () => {
  it('warns about time no invoice will bill, naming the entry, closed period and invoice, without raw ids', () => {
    const { container } = render(<LateHourlyTimeNotices idPrefix="late" notices={[notice(), notice({ entryId: '44444444-4444-4444-8444-444444444444', disposition: 'next_invoice' })]} />);
    const stranded = screen.getByTestId('late-stranded');
    expect(stranded).toHaveTextContent('Approved time that no invoice will bill (1)');
    expect(stranded).toHaveTextContent('Restore or extend the contract line');
    expect(stranded).toHaveTextContent('#000016 Printer queue');
    expect(stranded).toHaveTextContent('Service period 2026-10-01 – 2026-10-31 was invoiced on INV-000003');
    expect(screen.getByTestId('late-carried')).toHaveTextContent('Late approved time billed on the next invoice (1)');
    for (const id of ['2222', '3333']) expect(container.textContent).not.toContain(id.repeat(2));
  });

  it('renders nothing when there is no late time', () => {
    const { container } = render(<LateHourlyTimeNotices idPrefix="late" notices={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
