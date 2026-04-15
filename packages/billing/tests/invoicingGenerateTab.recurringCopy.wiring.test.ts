import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('invoicing generate tab recurring copy wiring', () => {
  it('documents automatic, manual, and prepayment invoice semantics in service-period-first language', () => {
    const overviewSource = readFileSync(
      resolve(__dirname, '../src/components/billing-dashboard/Overview.tsx'),
      'utf8',
    );
    const generateTabSource = readFileSync(
      resolve(__dirname, '../src/components/billing-dashboard/invoicing/GenerateTab.tsx'),
      'utf8',
    );
    const automaticSource = readFileSync(
      resolve(__dirname, '../src/components/billing-dashboard/AutomaticInvoices.tsx'),
      'utf8',
    );
    const manualSource = readFileSync(
      resolve(__dirname, '../src/components/billing-dashboard/ManualInvoices.tsx'),
      'utf8',
    );
    const prepaymentSource = readFileSync(
      resolve(__dirname, '../src/components/billing-dashboard/PrepaymentInvoices.tsx'),
      'utf8',
    );

    expect(overviewSource).toContain(
      'Generate invoice windows for recurring service periods and create manual or prepayment documents when financial handling differs from recurring coverage'
    );
    expect(generateTabSource).toContain(
      'Use invoice windows to review due recurring service periods before generating a recurring batch.'
    );
    expect(generateTabSource).toContain(
      'Use manual invoices for one-off or adjustment lines. They do not redefine recurring service periods.'
    );
    expect(generateTabSource).toContain(
      'Use prepayment and credit flows for financial value that should stay separate from recurring service-period coverage.'
    );
    expect(automaticSource).toContain(
      'Each row is an invoice window. Generated recurring invoices group the due service periods that land in that window.'
    );
    expect(manualSource).toContain(
      'Use manual invoices for one-off or adjustment lines. They coexist with recurring invoices without redefining recurring service periods.'
    );
    expect(manualSource).toContain(
      'Manual edits stay periodless by default, while recurring detail-backed lines keep their canonical service periods.'
    );
    expect(manualSource).toContain(
      'Mark this only when the manual invoice should create credit for future financial application instead of representing recurring service-period coverage.'
    );
    expect(prepaymentSource).toContain(
      'Prepayment invoices create client credit for future value. They do not create recurring service periods; later recurring invoices keep their own service-period coverage.'
    );
    expect(prepaymentSource).toContain(
      'Credit memos adjust financial balances without redefining recurring service-period coverage on the source invoice.'
    );
  });
});
