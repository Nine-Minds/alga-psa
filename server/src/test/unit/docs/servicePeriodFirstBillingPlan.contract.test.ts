import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../../../..');
const planRoot = path.join(
  repoRoot,
  'ee',
  'docs',
  'plans',
  '2026-03-16-service-period-first-billing-and-cadence-ownership'
);

const read = (file: string) => fs.readFileSync(path.join(planRoot, file), 'utf8');
const appendix = read('PASS0_RECURRING_TIMING_APPENDIX.md');
const prd = read('PRD.md');
const inventory = JSON.parse(read('pass-0-source-inventory.json')) as {
  timingControls: {
    resolveServicePeriodRefs: string[];
    billingCycleAlignmentRefs: string[];
  };
  periodFieldInventory: {
    servicePeriodFieldRefs: string[];
  };
  servicePeriodConsumers: {
    creditsRefs: string[];
    prepaymentRefs: string[];
    negativeInvoiceRefs: string[];
    accountingExportRefs: string[];
    portalBillingRefs: string[];
    reportingRefs: string[];
  };
  outOfScopeCompatibilityMatrix: Array<{ flow: string; status: string; boundary: string }>;
};

const rgList = (pattern: string, ...roots: string[]) =>
  execFileSync(
    'rg',
    ['-l', pattern, ...roots, '--glob', '!**/coverage/**', '--glob', '!**/dist/**'],
    { cwd: repoRoot, encoding: 'utf8' }
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((file) => file !== 'server/src/test/unit/docs/servicePeriodFirstBillingPlan.contract.test.ts')
    .sort();

const persistedReaderExclusions = new Set([
  'packages/types/src/interfaces/recurringTiming.interfaces.ts',
  'server/src/test/unit/billing/recurringTiming.domain.test.ts',
  'shared/billingClients/recurringTiming.ts',
]);

describe('service-period-first billing plan artifacts', () => {
  it('T001: inventory captures every live resolveServicePeriod reference in recurring timing paths', () => {
    expect(inventory.timingControls.resolveServicePeriodRefs.slice().sort()).toEqual(
      rgList('resolveServicePeriod', 'packages', 'server', 'shared')
    );
  });

  it('T002: inventory captures every live billing_cycle_alignment reference in runtime, schemas, UI, and tests', () => {
    expect(inventory.timingControls.billingCycleAlignmentRefs.slice().sort()).toEqual(
      rgList('billing_cycle_alignment', 'packages', 'server', 'shared')
    );
  });

  it('T003: inventory captures persisted service-period readers outside the billing engine', () => {
    const outsideEngine = rgList(
      'service_period_start|service_period_end|servicePeriodStart|servicePeriodEnd',
      'packages',
      'server',
      'shared'
    ).filter((file) =>
      file !== 'packages/billing/src/lib/billing/billingEngine.ts'
      && !persistedReaderExclusions.has(file)
    );

    expect(
      inventory.periodFieldInventory.servicePeriodFieldRefs
        .filter((file) => file !== 'packages/billing/src/lib/billing/billingEngine.ts')
        .slice()
        .sort()
    ).toEqual(outsideEngine);
  });

  it('T004: inventory captures credits, prepayment, negative-invoice, portal, reporting, and export consumers', () => {
    const consumerSet = new Set([
      ...inventory.servicePeriodConsumers.creditsRefs,
      ...inventory.servicePeriodConsumers.prepaymentRefs,
      ...inventory.servicePeriodConsumers.negativeInvoiceRefs,
      ...inventory.servicePeriodConsumers.accountingExportRefs,
      ...inventory.servicePeriodConsumers.portalBillingRefs,
      ...inventory.servicePeriodConsumers.reportingRefs
    ]);

    expect(consumerSet).toContain('packages/billing/src/actions/creditActions.ts');
    expect(consumerSet).toContain('server/src/test/infrastructure/billing/invoices/prepaymentInvoice.test.ts');
    expect(consumerSet).toContain('server/src/test/infrastructure/billing/invoices/negativeInvoiceCredit.test.ts');
    expect(consumerSet).toContain('packages/billing/src/services/accountingExportInvoiceSelector.ts');
    expect(consumerSet).toContain('packages/client-portal/src/actions/account.ts');
    expect(consumerSet).toContain('packages/billing/src/actions/contractReportActions.ts');
  });

  it('T005 and T006: parity matrix covers the required recurring scenario families and overlays', () => {
    expect(appendix).toContain('| Billing frequency | monthly, quarterly, semi-annual, annual, weekly, bi-weekly |');
    expect(appendix).toContain('| Due position | advance, arrears |');
    expect(appendix).toContain('| Coverage shape | full period, mid-period start, mid-period end, no-coverage |');
    expect(appendix).toContain('| Charge family | fixed recurring, recurring product, recurring license, recurring bucket / allowance where timing matters |');
    expect(appendix).toContain('| Commercial modifiers | pricing schedules, discounts, custom contract rates, catalog rates |');
    expect(appendix).toContain('| Financial overlays | purchase-order required, credits, prepayment, negative invoice follow-on |');
  });

  it('T007 and T008: parity harness contract defines comparable legacy and canonical outputs plus blocking drift rules', () => {
    expect(appendix).toContain('BillingEngine.calculateBilling(...)');
    expect(appendix).toContain('generateInvoice(...)');
    expect(appendix).toContain('candidate adapter contract');
    expect(appendix).toContain('Blocking drift:');
    expect(appendix).toContain('Non-blocking drift during staged rollout:');
  });

  it('T009: out-of-scope matrix explicitly names time, usage, materials, and manual-only boundaries', () => {
    const flowNames = inventory.outOfScopeCompatibilityMatrix.map((entry) => entry.flow);
    expect(flowNames).toEqual([
      'time entry billing',
      'usage-record billing',
      'materials and non-recurring charges',
      'manual-only invoices'
    ]);
  });

  it('T010: fixture builder contract stays cadence-owner-aware and independent from invoice side effects', () => {
    expect(appendix).toContain('cadence owner');
    expect(appendix).toContain('without requiring invoice persistence as a side effect');
    expect(appendix).toContain('fixed, product, and license recurring families');
  });

  it('documents the architecture thesis and system-surface matrix in the PRD and appendix', () => {
    expect(prd).toContain('## Architecture Thesis');
    expect(prd).toContain('cadence owner generates service-period boundaries');
    expect(prd).toContain('## System Surfaces In Scope');
    expect(appendix).toContain('## System-Surface Matrix');
    expect(appendix).toContain('Accounting exports');
    expect(appendix).toContain('Portal / reporting / downstream readers');
    expect(appendix).toContain('Migration / cleanup');
  });
});
