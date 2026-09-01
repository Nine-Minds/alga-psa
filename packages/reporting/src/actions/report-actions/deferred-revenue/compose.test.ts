import { describe, expect, it } from 'vitest';

import { buildDeferredRevenueReportFromData } from './compose';
import type { CreditTrackingDetailRow } from './loaders';
import type { CreditTransactionRow } from './credits';
import type { RawBucketPeriodRow } from './loaders';
import type { CreditSourceInvoice } from './creditSource';

const FEB = '2026-02-15T10:00:00.000Z';

const creditTransactions: CreditTransactionRow[] = [
  {
    transactionId: 'txn-credit-1',
    clientId: 'client-1',
    currencyCode: 'USD',
    type: 'credit_issuance',
    amount: 500000,
    createdAt: '2026-01-15T10:00:00.000Z',
  },
  {
    transactionId: 'txn-credit-2',
    clientId: 'client-1',
    currencyCode: 'USD',
    type: 'credit_application',
    amount: -200000,
    createdAt: FEB,
    metadata: {
      applied_credits: [
        { creditId: 'credit-1', amount: 200000, transactionId: 'txn-credit-1' },
      ],
    },
    relatedTransactionId: 'txn-credit-1',
  },
  {
    transactionId: 'txn-credit-3',
    clientId: 'client-2',
    currencyCode: 'EUR',
    type: 'credit_issuance',
    amount: 100000,
    createdAt: FEB,
  },
];

const creditTracking: CreditTrackingDetailRow[] = [
  {
    creditId: 'credit-1',
    transactionId: 'txn-credit-1',
    clientId: 'client-1',
    currencyCode: 'USD',
    amount: 500000,
    remainingAmount: 300000,
    expirationDate: null,
    isExpired: false,
    transactionType: 'credit_issuance',
    issuedDate: '2026-01-15T10:00:00.000Z',
    description: 'Prepayment',
    invoiceId: 'inv-prepay',
    metadata: null,
  },
];

const bucketPeriods: RawBucketPeriodRow[] = [
  {
    usageId: 'usage-1',
    contractLineId: 'line-1',
    contractId: 'contract-1',
    contractLineName: 'Block Hours',
    clientId: 'client-1',
    serviceId: 'svc-1',
    serviceName: 'Engineering',
    periodStart: '2026-02-01',
    periodEnd: '2026-02-28',
    minutesUsed: 2400,
    rolledOverMinutes: 0,
    totalMinutes: 6000,
    allowRollover: false,
    currencyCode: 'USD',
    lineCustomRate: null,
    catalogDefaultRate: null,
  },
];

function makeData(over: Partial<Parameters<typeof buildDeferredRevenueReportFromData>[0]> = {}) {
  return {
    clients: [
      { clientId: 'client-1', clientName: 'Acme', defaultCurrencyCode: 'USD' },
      { clientId: 'client-2', clientName: 'Zed Inc', defaultCurrencyCode: 'EUR' },
    ],
    creditTransactions,
    creditTracking,
    creditInvoices: new Map<string, CreditSourceInvoice>([
      ['inv-prepay', { invoiceId: 'inv-prepay', invoiceNumber: 'PP-1', isPrepayment: true, invoiceType: 'prepayment' }],
    ]),
    bucketPeriods,
    billedFees: [
      {
        contractLineId: 'line-1',
        serviceId: 'svc-1',
        servicePeriodStart: '2026-02-01',
        servicePeriodEnd: '2026-02-28',
        feeCents: 100000,
      },
    ],
    fixedConfigBaseRates: new Map<string, number | null>(),
    pricingSchedules: [],
    ...over,
  };
}

describe('buildDeferredRevenueReportFromData', () => {
  it('merges credits and hours per client×currency with tenant totals', () => {
    const report = buildDeferredRevenueReportFromData(makeData(), '2026-02');

    expect(report.month).toBe('2026-02');
    expect(report.sections).toHaveLength(2);
    expect(report.sections.map((section) => section.currencyCode)).toEqual(['EUR', 'USD']);

    const usd = report.sections.find((section) => section.currencyCode === 'USD')!;
    expect(usd.clients).toHaveLength(1);
    const acme = usd.clients[0];
    expect(acme.clientName).toBe('Acme');
    expect(acme.credits.opening).toBe(500000);
    expect(acme.credits.applied).toBe(-200000);
    expect(acme.credits.closing).toBe(300000);
    expect(acme.hours.issued).toBe(100000);
    expect(acme.hours.applied).toBeCloseTo(-(2400 * (100000 / 6000)), 6);
    expect(acme.hours.closing).toBe(0);
    expect(acme.total.opening).toBe(500000);
    expect(acme.total.closing).toBeCloseTo(300000, 6);
    // Total movement columns close arithmetically with the hours signed like
    // the credits: 500000 + 100000 - 240000 - 60000 = 300000.
    expect(
      acme.total.opening + acme.total.issued + acme.total.applied + acme.total.expired,
    ).toBeCloseTo(acme.total.closing, 6);

    const eur = report.sections.find((section) => section.currencyCode === 'EUR')!;
    expect(eur.totals.total.closing).toBe(100000);
  });

  it('flags prepayment-sourced credit details as qbo-unreachable', () => {
    const report = buildDeferredRevenueReportFromData(makeData(), '2026-02');
    const usd = report.sections.find((section) => section.currencyCode === 'USD')!;
    const detail = usd.clients[0].creditDetails[0];
    expect(detail.sourceKind).toBe('prepayment');
    expect(detail.qboReachable).toBe(false);
    expect(detail.invoiceNumber).toBe('PP-1');
  });

  it('discloses the spanning-period burn fallback in notes when taken', () => {
    const report = buildDeferredRevenueReportFromData(
      makeData({
        bucketPeriods: [
          {
            ...bucketPeriods[0],
            periodStart: '2026-02-15',
            periodEnd: '2026-03-14',
          },
        ],
      }),
      '2026-02',
    );
    expect(report.notes).toContain(
      'Bucket periods spanning calendar-month boundaries attribute their burn to the month the period ends in.',
    );
  });

  it('keeps notes empty when no period spans a month boundary', () => {
    const report = buildDeferredRevenueReportFromData(makeData(), '2026-02');
    expect(report.notes).toHaveLength(0);
  });

  it('omits zero-balance clients with no movement and no outstanding credit', () => {
    const report = buildDeferredRevenueReportFromData(
      makeData({
        creditTransactions: [],
        creditTracking: [],
        bucketPeriods: [],
        clients: [
          { clientId: 'client-1', clientName: 'Quiet Co', defaultCurrencyCode: 'USD' },
        ],
      }),
      '2026-02',
    );
    expect(report.sections).toHaveLength(0);
  });

  it('omits a client whose only bucket periods do not contribute to the selected month (Defect 1)', () => {
    // Both of client-1's periods sit outside February: one fully burned in the
    // past, one starting in the future. Neither carries liability into the
    // month, so no detail rows are emitted and the client is absent from the
    // report even though its only periods would previously have surfaced rows.
    const report = buildDeferredRevenueReportFromData(
      makeData({
        creditTransactions: [],
        creditTracking: [],
        bucketPeriods: [
          { ...bucketPeriods[0], usageId: 'usage-past', periodStart: '2025-12-01', periodEnd: '2025-12-31', minutesUsed: 6000 },
          { ...bucketPeriods[0], usageId: 'usage-future', periodStart: '2026-03-01', periodEnd: '2026-03-31', minutesUsed: 0 },
        ],
      }),
      '2026-02',
    );
    expect(report.sections).toHaveLength(0);
  });

  it('retains a client whose carried-in bucket opens the selected month even with no movement (Defect 1)', () => {
    // client-1 holds a February period that opens carrying a January rollover
    // (nonzero opening) with no in-month burn — a contributor that must stay.
    const report = buildDeferredRevenueReportFromData(
      makeData({
        creditTransactions: [],
        creditTracking: [],
        bucketPeriods: [
          { ...bucketPeriods[0], rolledOverMinutes: 1200, minutesUsed: 0, allowRollover: true },
        ],
      }),
      '2026-02',
    );
    const usd = report.sections.find((section) => section.currencyCode === 'USD');
    expect(usd).toBeDefined();
    const acme = usd!.clients.find((client) => client.clientName === 'Acme');
    expect(acme).toBeDefined();
    expect(acme!.hours.opening).toBe(1200 * (100000 / 6000));
    expect(acme!.bucketDetails).toHaveLength(1);
  });

  it('omits a client whose only credit activity is after the selected month (Defect 2)', () => {
    // client-1's only credit is issued in April; February sees zero opening,
    // zero movement, zero closing. The credit did not exist in February, so no
    // detail row may surface the client for that month.
    const report = buildDeferredRevenueReportFromData(
      makeData({
        creditTransactions: [
          {
            transactionId: 'txn-future',
            clientId: 'client-1',
            currencyCode: 'USD',
            type: 'credit_issuance',
            amount: 500000,
            createdAt: '2026-04-15T10:00:00.000Z',
          },
        ],
        creditTracking: [
          {
            creditId: 'credit-future',
            transactionId: 'txn-future',
            clientId: 'client-1',
            currencyCode: 'USD',
            amount: 500000,
            remainingAmount: 500000,
            expirationDate: null,
            isExpired: false,
            transactionType: 'credit_issuance',
            issuedDate: '2026-04-15T10:00:00.000Z',
            description: 'Future-dated credit',
            invoiceId: null,
            metadata: null,
          },
        ],
        bucketPeriods: [],
      }),
      '2026-02',
    );
    expect(report.sections).toHaveLength(0);
  });

  it('retains a client with a pre-month credit issuance whose application lands in a future month (Defect 2)', () => {
    // client-1's credit was issued in January and is applied in April; for
    // February it contributes opening and closing liability of 5000. The
    // client must appear with the February closing balance and a detail row
    // that reconciles to it.
    const report = buildDeferredRevenueReportFromData(
      makeData({
        creditTransactions: [
          {
            transactionId: 'txn-pre',
            clientId: 'client-1',
            currencyCode: 'USD',
            type: 'credit_issuance',
            amount: 500000,
            createdAt: '2026-01-15T10:00:00.000Z',
          },
          {
            transactionId: 'txn-app-future',
            clientId: 'client-1',
            currencyCode: 'USD',
            type: 'credit_application',
            amount: -500000,
            createdAt: '2026-04-15T10:00:00.000Z',
          },
        ],
        creditTracking: [
          {
            creditId: 'credit-pre',
            transactionId: 'txn-pre',
            clientId: 'client-1',
            currencyCode: 'USD',
            amount: 500000,
            remainingAmount: 500000,
            expirationDate: null,
            isExpired: false,
            transactionType: 'credit_issuance',
            issuedDate: '2026-01-15T10:00:00.000Z',
            description: 'Pre-month prepayment',
            invoiceId: 'inv-prepay',
            metadata: null,
          },
        ],
        bucketPeriods: [],
      }),
      '2026-02',
    );

    const usd = report.sections.find((section) => section.currencyCode === 'USD');
    expect(usd).toBeDefined();
    expect(usd!.clients).toHaveLength(1);
    const acme = usd!.clients[0];
    expect(acme.credits.opening).toBe(500000);
    expect(acme.credits.closing).toBe(500000);
    expect(acme.creditDetails).toHaveLength(1);
    expect(acme.creditDetails[0].creditId).toBe('credit-pre');
    expect(acme.creditDetails[0].remainingAmount).toBe(500000);
    expect(
      acme.creditDetails.reduce((sum, detail) => sum + detail.remainingAmount, 0),
    ).toBe(acme.credits.closing);
  });

  it('reconstructs month-M detail for a credit issued in M-1 and fully applied in M+1 (fix round 3)', () => {
    // Regression: the credit's current tracking remaining is 0 (fully applied
    // today), so the old remainingAmount > 0 predicate dropped the row and the
    // detail no longer reconciled to the February closing. The ledger
    // reconstruction restores the M-end balance and the row.
    const report = buildDeferredRevenueReportFromData(
      makeData({
        creditTransactions: [
          {
            transactionId: 'txn-iss-jan',
            clientId: 'client-1',
            currencyCode: 'USD',
            type: 'credit_issuance',
            amount: 200000,
            createdAt: '2026-01-15T10:00:00.000Z',
          },
          {
            transactionId: 'txn-app-mar',
            clientId: 'client-1',
            currencyCode: 'USD',
            type: 'credit_application',
            amount: -200000,
            createdAt: '2026-03-15T10:00:00.000Z',
            metadata: {
              applied_credits: [
                { creditId: 'credit-later', amount: 200000, transactionId: 'txn-iss-jan' },
              ],
            },
            relatedTransactionId: 'txn-iss-jan',
          },
        ],
        creditTracking: [
          {
            creditId: 'credit-later',
            transactionId: 'txn-iss-jan',
            clientId: 'client-1',
            currencyCode: 'USD',
            amount: 200000,
            remainingAmount: 0,
            expirationDate: null,
            isExpired: false,
            transactionType: 'credit_issuance',
            issuedDate: '2026-01-15T10:00:00.000Z',
            description: 'Prepayment applied later',
            invoiceId: null,
            metadata: null,
          },
        ],
        bucketPeriods: [],
      }),
      '2026-02',
    );

    const usd = report.sections.find((section) => section.currencyCode === 'USD');
    expect(usd).toBeDefined();
    expect(usd!.clients).toHaveLength(1);
    const acme = usd!.clients[0];
    expect(acme.credits.opening).toBe(200000);
    expect(acme.credits.closing).toBe(200000);
    expect(acme.creditDetails).toHaveLength(1);
    const detail = acme.creditDetails[0];
    expect(detail.creditId).toBe('credit-later');
    expect(detail.remainingAmount).toBe(200000);
    expect(detail.inMonthMovement).toBe(0);
    expect(
      acme.creditDetails.reduce((sum, row) => sum + row.remainingAmount, 0),
    ).toBe(acme.credits.closing);
  });

  it('keeps the fully-applied-in-M+1 credit on the month after application with a reconciling zero detail (fix round 3)', () => {
    const data = makeData({
      creditTransactions: [
        {
          transactionId: 'txn-iss-jan',
          clientId: 'client-1',
          currencyCode: 'USD',
          type: 'credit_issuance',
          amount: 200000,
          createdAt: '2026-01-15T10:00:00.000Z',
        },
        {
          transactionId: 'txn-app-mar',
          clientId: 'client-1',
          currencyCode: 'USD',
          type: 'credit_application',
          amount: -200000,
          createdAt: '2026-03-15T10:00:00.000Z',
          metadata: {
            applied_credits: [
              { creditId: 'credit-later', amount: 200000, transactionId: 'txn-iss-jan' },
            ],
          },
          relatedTransactionId: 'txn-iss-jan',
        },
      ],
      creditTracking: [
        {
          creditId: 'credit-later',
          transactionId: 'txn-iss-jan',
          clientId: 'client-1',
          currencyCode: 'USD',
          amount: 200000,
          remainingAmount: 0,
          expirationDate: null,
          isExpired: false,
          transactionType: 'credit_issuance',
          issuedDate: '2026-01-15T10:00:00.000Z',
          description: 'Prepayment applied later',
          invoiceId: null,
          metadata: null,
        },
      ],
      bucketPeriods: [],
    });

    const mar = buildDeferredRevenueReportFromData(data, '2026-03');
    const usd = mar.sections.find((section) => section.currencyCode === 'USD');
    expect(usd).toBeDefined();
    const acme = usd!.clients[0];
    expect(acme.credits.closing).toBe(0);
    expect(acme.creditDetails).toHaveLength(1);
    expect(acme.creditDetails[0].remainingAmount).toBe(0);
    expect(acme.creditDetails[0].inMonthMovement).toBe(-200000);
    expect(
      acme.creditDetails.reduce((sum, row) => sum + row.remainingAmount, 0),
    ).toBe(acme.credits.closing);
  });

  it('restores a credit reversed by a FinancialService-shaped adjustment through the application\'s applied_credits (fix round 3)', () => {
    // FinancialService.bulkTransactionOperation (reverse) writes a credit_adjustment
    // with only related_transaction_id → the original credit_application and no
    // metadata. That application carries canonical metadata.applied_credits, so
    // the reversal must be attributed: report closing, retained detail row, and
    // the detail-to-closing reconciliation all agree at 200000 for the month
    // containing the reversal.
    const report = buildDeferredRevenueReportFromData(
      makeData({
        creditTransactions: [
          {
            transactionId: 'txn-iss-jan',
            clientId: 'client-1',
            currencyCode: 'USD',
            type: 'credit_issuance',
            amount: 200000,
            createdAt: '2026-01-15T10:00:00.000Z',
          },
          {
            transactionId: 'txn-app-feb',
            clientId: 'client-1',
            currencyCode: 'USD',
            type: 'credit_application',
            amount: -200000,
            createdAt: '2026-02-15T10:00:00.000Z',
            metadata: {
              applied_credits: [
                { creditId: 'credit-rev', amount: 200000, transactionId: 'txn-iss-jan' },
              ],
            },
            relatedTransactionId: 'txn-iss-jan',
          },
          {
            transactionId: 'txn-rev-mar',
            clientId: 'client-1',
            currencyCode: 'USD',
            type: 'credit_adjustment',
            amount: 200000,
            createdAt: '2026-03-15T10:00:00.000Z',
            relatedTransactionId: 'txn-app-feb',
          },
        ],
        creditTracking: [
          {
            creditId: 'credit-rev',
            transactionId: 'txn-iss-jan',
            clientId: 'client-1',
            currencyCode: 'USD',
            amount: 200000,
            remainingAmount: 0,
            expirationDate: null,
            isExpired: false,
            transactionType: 'credit_issuance',
            issuedDate: '2026-01-15T10:00:00.000Z',
            description: 'Prepayment restored by reversal',
            invoiceId: null,
            metadata: null,
          },
        ],
        bucketPeriods: [],
      }),
      '2026-03',
    );

    const usd = report.sections.find((section) => section.currencyCode === 'USD');
    expect(usd).toBeDefined();
    expect(usd!.clients).toHaveLength(1);
    const acme = usd!.clients[0];
    expect(acme.credits.opening).toBe(0);
    expect(acme.credits.adjustments).toBe(200000);
    expect(acme.credits.closing).toBe(200000);
    expect(acme.creditDetails).toHaveLength(1);
    const detail = acme.creditDetails[0];
    expect(detail.creditId).toBe('credit-rev');
    expect(detail.remainingAmount).toBe(200000);
    expect(
      acme.creditDetails.reduce((sum, row) => sum + row.remainingAmount, 0),
    ).toBe(acme.credits.closing);
  });
});
