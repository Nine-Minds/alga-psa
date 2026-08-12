// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DeferredRevenueReport as DeferredRevenueReportPayload,
  CreditDetailRow,
} from '@alga-psa/reporting/actions/report-actions/getDeferredRevenueReport';
const getDeferredRevenueReport = vi.fn();

// Stable stubs so the report effect (keyed on `t`) does not re-fetch on every
// render — the employeeUtilization render test uses the same echo-id pattern.
const stubT = (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key;
const stubFormatCurrency = (value: number, currency: string) => `${currency} ${value.toFixed(2)}`;

// The server-suite setup stubs this hook with empty automationIdProps, which
// strips DOM ids off UI Buttons — echo ids back with a local stub (same
// pattern as Reports.employeeUtilization.render.test.tsx).
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: (params?: { id?: string }) => ({
    automationIdProps: params?.id
      ? { id: params.id, 'data-automation-id': params.id }
      : {},
    updateMetadata: vi.fn(),
  }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: stubT }),
  useFormatters: () => ({ formatCurrency: stubFormatCurrency }),
}));

vi.mock('@alga-psa/reporting/actions/report-actions/getDeferredRevenueReport', () => ({
  getDeferredRevenueReport: (...args: unknown[]) => getDeferredRevenueReport(...args),
}));

const { default: DeferredRevenueReport } = await import(
  '@alga-psa/reporting/components/deferred-revenue/DeferredRevenueReport'
);

function movement(over: Partial<DeferredRevenueReportPayload['sections'][number]['clients'][number]['credits']> = {}) {
  return {
    opening: 0,
    issued: 0,
    applied: 0,
    expired: 0,
    adjustments: 0,
    closing: 0,
    ...over,
  };
}

function creditDetail(
  over: Partial<Omit<CreditDetailRow, 'sourceKind'>> & { sourceKind?: CreditDetailRow['sourceKind'] } = {},
): CreditDetailRow {
  return {
    creditId: 'credit-1',
    transactionId: 'txn-1',
    clientId: 'client-1',
    issuedDate: '2026-06-15T10:00:00.000Z',
    description: 'Prepayment',
    amount: 5000,
    remainingAmount: 5000,
    expirationDate: null,
    isExpired: false,
    sourceKind: 'prepayment',
    qboReachable: false,
    invoiceNumber: 'PP-1',
    currencyCode: 'USD',
    ...over,
  };
}

function clientRow(over: Partial<DeferredRevenueReportPayload['sections'][number]['clients'][number]> & {
  clientId: string;
  clientName: string;
}) {
  const base = {
    clientId: over.clientId,
    clientName: over.clientName,
    currencyCode: 'USD',
    credits: movement(),
    hours: movement(),
    total: movement(),
    creditDetails: [] as DeferredRevenueReportPayload['sections'][number]['clients'][number]['creditDetails'],
    bucketDetails: [] as DeferredRevenueReportPayload['sections'][number]['clients'][number]['bucketDetails'],
  };
  const merged = { ...base, ...over, clientId: over.clientId, clientName: over.clientName };
  if (over.credits) merged.credits = over.credits;
  if (over.hours) merged.hours = over.hours;
  if (over.total) merged.total = over.total;
  if (over.creditDetails) merged.creditDetails = over.creditDetails;
  if (over.bucketDetails) merged.bucketDetails = over.bucketDetails;
  return merged;
}

function section(sectionOver: {
  currencyCode: string;
  clients: DeferredRevenueReportPayload['sections'][number]['clients'];
}): DeferredRevenueReportPayload['sections'][number] {
  const credits = { opening: 0, issued: 0, applied: 0, expired: 0, adjustments: 0, closing: 0 };
  const hours = { ...credits };
  const total = { ...credits };
  for (const client of sectionOver.clients) {
    for (const key of ['opening', 'issued', 'applied', 'expired', 'adjustments', 'closing'] as const) {
      credits[key] += client.credits[key];
      hours[key] += client.hours[key];
      total[key] += client.total[key];
    }
  }
  return { currencyCode: sectionOver.currencyCode, totals: { credits, hours, total }, clients: sectionOver.clients };
}

function reportPayload(
  sections: DeferredRevenueReportPayload['sections'],
): DeferredRevenueReportPayload {
  return {
    month: '2026-07',
    generatedAt: '2026-08-11T00:00:00.000Z',
    sections,
    notes: [],
  };
}

afterEach(() => {
  cleanup();
  getDeferredRevenueReport.mockReset();
});

describe('DeferredRevenueReport expansion toggle', () => {
  it('expands only the clicked client row and collapses it on a second click', async () => {
    getDeferredRevenueReport.mockResolvedValue(
      reportPayload([
        section({
          currencyCode: 'USD',
          clients: [
            clientRow({
              clientId: 'client-acme',
              clientName: 'Acme Corp',
              credits: movement({ issued: 5000, closing: 5000 }),
              total: movement({ issued: 5000, closing: 5000 }),
              creditDetails: [
                creditDetail({
                  creditId: 'credit-acme',
                  transactionId: 'txn-acme',
                  clientId: 'client-acme',
                  description: 'Acme prepayment credit',
                  remainingAmount: 5000,
                }),
              ],
            }),
            clientRow({
              clientId: 'client-globex',
              clientName: 'Globex Inc',
              credits: movement({ issued: 3000, closing: 3000 }),
              total: movement({ issued: 3000, closing: 3000 }),
              creditDetails: [
                creditDetail({
                  creditId: 'credit-globex',
                  transactionId: 'txn-globex',
                  clientId: 'client-globex',
                  description: 'Globex prepayment credit',
                  remainingAmount: 3000,
                }),
              ],
            }),
          ],
        }),
      ]),
    );

    render(<DeferredRevenueReport />);

    // The client name appears both in the rollforward table and the print view.
    expect((await screen.findAllByText('Acme Corp')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Acme prepayment credit')).toBeNull();
    expect(screen.queryByText('Globex prepayment credit')).toBeNull();

    await userEvent.click(screen.getAllByText('Acme Corp')[0]);
    expect(screen.getByText('Acme prepayment credit')).toBeTruthy();
    expect(screen.queryByText('Globex prepayment credit')).toBeNull();

    await userEvent.click(screen.getAllByText('Acme Corp')[0]);
    expect(screen.queryByText('Acme prepayment credit')).toBeNull();
    expect(screen.queryByText('Globex prepayment credit')).toBeNull();
  });

  it('keys expansion per client×currency so one currency row does not expand the other', async () => {
    getDeferredRevenueReport.mockResolvedValue(
      reportPayload([
        section({
          currencyCode: 'USD',
          clients: [
            clientRow({
              clientId: 'client-acme',
              clientName: 'Acme Corp',
              credits: movement({ issued: 5000, closing: 5000 }),
              total: movement({ issued: 5000, closing: 5000 }),
              creditDetails: [
                creditDetail({
                  creditId: 'credit-acme-usd',
                  clientId: 'client-acme',
                  description: 'USD prepayment credit',
                  remainingAmount: 5000,
                }),
              ],
            }),
          ],
        }),
        section({
          currencyCode: 'EUR',
          clients: [
            clientRow({
              clientId: 'client-acme',
              clientName: 'Acme Corp',
              currencyCode: 'EUR',
              credits: movement({ issued: 2000, closing: 2000 }),
              total: movement({ issued: 2000, closing: 2000 }),
              creditDetails: [
                creditDetail({
                  creditId: 'credit-acme-eur',
                  clientId: 'client-acme',
                  currencyCode: 'EUR',
                  description: 'EUR prepayment credit',
                  remainingAmount: 2000,
                }),
              ],
            }),
          ],
        }),
      ]),
    );

    render(<DeferredRevenueReport />);

    // The client name appears both in the rollforward table and the print view.
    expect((await screen.findAllByText('Acme Corp')).length).toBeGreaterThan(0);
    expect(screen.queryByText('USD prepayment credit')).toBeNull();
    expect(screen.queryByText('EUR prepayment credit')).toBeNull();

    await userEvent.click(within(screen.getByLabelText('USD rollforward')).getByText('Acme Corp'));
    expect(screen.getByText('USD prepayment credit')).toBeTruthy();
    expect(screen.queryByText('EUR prepayment credit')).toBeNull();

    await userEvent.click(within(screen.getByLabelText('EUR rollforward')).getByText('Acme Corp'));
    expect(screen.getByText('USD prepayment credit')).toBeTruthy();
    expect(screen.getByText('EUR prepayment credit')).toBeTruthy();

    await userEvent.click(within(screen.getByLabelText('USD rollforward')).getByText('Acme Corp'));
    expect(screen.queryByText('USD prepayment credit')).toBeNull();
    expect(screen.getByText('EUR prepayment credit')).toBeTruthy();
  });
});
