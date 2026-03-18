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
const featureSubsystemMap = read('FEATURE_SUBSYSTEM_MAP.md');
const prd = read('PRD.md');
const reportingDateBasis = read('REPORTING_DATE_BASIS.md');
const recurrenceStorageMatrix = read('RECURRENCE_STORAGE_MATRIX.md');
const runbook = read('RUNBOOK.md');
const contractReportActionsSource = fs.readFileSync(
  path.join(repoRoot, 'packages', 'billing', 'src', 'actions', 'contractReportActions.ts'),
  'utf8'
);
const portalDashboardSource = fs.readFileSync(
  path.join(repoRoot, 'packages', 'client-portal', 'src', 'actions', 'client-portal-actions', 'dashboard.ts'),
  'utf8'
);
const reconciliationReportActionsSource = fs.readFileSync(
  path.join(repoRoot, 'packages', 'reporting', 'src', 'actions', 'reconciliationReportActions.ts'),
  'utf8'
);
const financialServiceSource = fs.readFileSync(
  path.join(repoRoot, 'server', 'src', 'lib', 'api', 'services', 'FinancialService.ts'),
  'utf8'
);
const inventory = JSON.parse(read('pass-0-source-inventory.json')) as {
  timingControls: {
    resolveServicePeriodRefs: string[];
    productLateStageProrationRefs: string[];
    licenseLateStageProrationRefs: string[];
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

  it('T151: staged rollout keeps client-cadence parity ahead of any contract-cadence enablement', () => {
    expect(appendix).toContain('## Staged Rollout Plan');
    expect(appendix).toContain('### Stage 1 — Additive groundwork only');
    expect(appendix).toContain('Keep contract cadence blocked on all live write paths;');
    expect(appendix).toContain('### Stage 2 — Client-cadence parity comparison');
    expect(appendix).toContain('Run comparison mode for client-cadence recurring lines only.');
    expect(appendix).toContain('contract cadence remains write-blocked while parity comparison is still required');
    expect(appendix).toContain('### Stage 3 — Client-cadence cutover');
    expect(appendix).toContain('Keep contract cadence blocked until client-cadence parity validation is signed off');
    expect(appendix).toContain('### Stage 4 — Contract-cadence enablement');
    expect(appendix).toContain('Enable contract cadence only after Stage 3 has been stable long enough to prove parity');
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

  it('T060: appendix explicitly freezes bucket, time, and usage behaviors outside the first recurring cut', () => {
    expect(appendix).toContain('Time entry billing stays event-driven in v1:');
    expect(appendix).toContain('selection continues to use `time_entries.start_time` / `time_entries.end_time` against the invoice window');
    expect(appendix).toContain('Usage-record billing stays event-driven in v1:');
    expect(appendix).toContain('selection continues to use usage-event dates and current end-exclusive overlap rules');
    expect(appendix).toContain('Bucket behavior is split explicitly:');
    expect(appendix).toContain('in scope now: recurring bucket contract lines where allowance periods, rollover, overage charging, and tax-date evaluation already depend on recurring timing semantics');
    expect(appendix).toContain('still out of scope: generic bucket reporting, remaining-unit readers, and other bucket metrics that are not tied to recurring contract-backed billing selection');
  });

  it('T168: advanced service-period ledger extensions remain an explicit follow-on boundary instead of leaking into recurring v1', () => {
    expect(prd).toContain('## Follow-on Boundary — Advanced Service-Period Ledger Extensions');
    expect(prd).toContain('long-range materialization horizons beyond the v1 operational window');
    expect(prd).toContain('archival or cold-storage strategies for billed or superseded service-period records');
    expect(prd).toContain('performance-oriented denormalization, read-side caches, or projection tables');
    expect(appendix).toContain('## Follow-On Boundary — Advanced Service-Period Ledger Extensions');
    expect(appendix).toContain('Recurring v1 must stop at the first authoritative persisted service-period ledger');
    expect(appendix).toContain('Trigger this follow-on only when there is source-backed evidence that v1 cannot stay operationally safe without it');
    expect(appendix).toContain('rollback posture if tenants temporarily carry both the canonical ledger and performance-oriented derivatives');
  });

  it('T169: time and usage unification remains an explicit follow-on boundary instead of leaking into recurring v1', () => {
    expect(prd).toContain('## Follow-on Boundary — Time And Usage Unification');
    expect(prd).toContain('time-entry billing and usage-record billing stay on their event-driven truth sources for recurring v1');
    expect(prd).toContain('a separate follow-on plan is required before time or usage can adopt canonical service-period or ledger semantics');
    expect(appendix).toContain('## Follow-On Boundary — Full Time And Usage Unification');
    expect(appendix).toContain('Recurring v1 does not silently expand into a general time-and-usage service-period ledger.');
    expect(appendix).toContain('time-entry billing keeps `time_entries.start_time` / `time_entries.end_time` and current invoice-window overlap semantics as its authoritative selection model');
    expect(appendix).toContain('usage-record billing keeps usage-event timestamps and current billed-through semantics as its authoritative selection model');
  });

  it('T061: recurring product timing sources remain source-backed after migration', () => {
    expect(inventory.timingControls.productLateStageProrationRefs.slice().sort()).toEqual(
      rgList(
        'calculateProductCharges\\(|Error calculating initial tax for product service|Missing pricing for product',
        'packages',
        'server',
        'shared'
      )
    );
    expect(appendix).toContain('### Recurring product migration seam inventory');
    expect(appendix).toContain('now resolves due product periods through the shared recurring timing helper');
    expect(appendix).toContain('now excludes license-tagged catalog rows so product and license recurring families do not double-bill the same catalog item');
    expect(appendix).toContain('Product tax now evaluates against the canonical due service-period end date');
  });

  it('T065: recurring license timing sources remain source-backed after migration', () => {
    expect(inventory.timingControls.licenseLateStageProrationRefs.slice().sort()).toEqual(
      rgList(
        `calculateLicenseCharges\\(|Error calculating initial tax for license service|Missing pricing for license`,
        'packages',
        'server',
        'shared'
      )
    );
    expect(appendix).toContain('### Recurring license migration seam inventory');
    expect(appendix).toContain('now resolves due license periods through the same shared recurring timing helper used by fixed and product recurring charges');
    expect(appendix).toContain('now uses explicit `service_catalog.item_kind = product` plus `is_license = true` selection so the placeholder license query is gone');
    expect(appendix).toContain('License tax and period metadata now evaluate from the canonical due service period');
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

  it('T250: the recurrence field source-of-truth matrix matches the authoritative storage model and compatibility seams', () => {
    expect(recurrenceStorageMatrix).toContain('# Recurrence Storage Matrix');
    expect(recurrenceStorageMatrix).toContain('`contract_lines.billing_timing`');
    expect(recurrenceStorageMatrix).toContain('`contract_template_lines.billing_timing`');
    expect(recurrenceStorageMatrix).toContain('`contract_line_presets.billing_timing`');
    expect(recurrenceStorageMatrix).toContain('`contract_template_line_terms.billing_timing` is legacy read compatibility only');
    expect(recurrenceStorageMatrix).toContain('`contract_template_line_fixed_config.enable_proration`');
    expect(recurrenceStorageMatrix).toContain('`contract_line_preset_fixed_config.enable_proration`');
    expect(recurrenceStorageMatrix).toContain('Readers may fall back for staged compatibility, but writes must target the authoritative storage surface');
  });

  it('T160: runbook covers parity checks, mixed-cadence troubleshooting, and rollback posture with executable commands', () => {
    expect(runbook).toContain('# Service-Period-First Billing Runbook');
    expect(runbook).toContain('## Parity Checks');
    expect(runbook).toContain('npx vitest run src/test/unit/billing/billingEngine.cleanupSource.test.ts --coverage.enabled false');
    expect(runbook).toContain('DB_PORT=57433 npx vitest run src/test/integration/billingInvoiceTiming.integration.test.ts -t "T171|T172|T173|T174" --coverage.enabled false');
    expect(runbook).toContain('RECURRING_BILLING_COMPARISON_MODE=legacy-vs-canonical');
    expect(runbook).toContain('## Mixed-Cadence Troubleshooting');
    expect(runbook).toContain('contract_lines.cadence_owner');
    expect(runbook).toContain('invoice_charge_details');
    expect(runbook).toContain('## Rollback Posture');
    expect(runbook).toContain('do not delete canonical `invoice_charge_details` rows');
    expect(runbook).toContain('do not force `billing_cycle_alignment` back into live execution');
  });

  it('T148: runbook explains how to trace cadence-owner disputes and service-period mismatches through persisted metadata', () => {
    expect(runbook).toContain('## Cadence-Owner Dispute Investigation');
    expect(runbook).toContain('was the line stored as `client` cadence or `contract` cadence when the invoice was generated?');
    expect(runbook).toContain('cl.contract_line_id,');
    expect(runbook).toContain('left join invoice_charge_details icd');
    expect(runbook).toContain('## Service-Period Mismatch Investigation');
    expect(runbook).toContain('invoice headers remain the invoice-window grouping dates');
    expect(runbook).toContain('canonical recurring detail rows remain the authoritative recurring coverage dates for migrated recurring lines');
    expect(runbook).toContain('If the detail period is correct but the consumer output is wrong, investigate reader hydration, flattening, or export adapter logic.');
  });

  it('T170: feature-to-subsystem mapping stays explicit enough to trace implementation progress across all affected surfaces', () => {
    expect(featureSubsystemMap).toContain('# Feature-To-Subsystem Map');
    expect(featureSubsystemMap).toContain('## Tracking Discipline');
    expect(featureSubsystemMap).toContain('## Subsystem Bands');
    expect(featureSubsystemMap).toContain('Architecture, inventory, and parity scaffolding');
    expect(featureSubsystemMap).toContain('Invoice generation, persistence, and recurring billing runs');
    expect(featureSubsystemMap).toContain('Data model, repositories, APIs, and recurrence storage reconciliation');
    expect(featureSubsystemMap).toContain('Reporting, portal readers, and accounting/export consumers');
    expect(featureSubsystemMap).toContain('Materialized service-period ledger');
    expect(featureSubsystemMap).toContain('runtime billing and timing domain');
    expect(featureSubsystemMap).toContain('credits, prepayment, and negative-invoice flows');
  });

  it('T221: reporting-date-basis policy distinguishes billing overview and finance-reporting families explicitly', () => {
    expect(reportingDateBasis).toContain('# Reporting And Analytics Date-Basis Policy');
    expect(reportingDateBasis).toContain('| Billing overview and invoice summary surfaces |');
    expect(reportingDateBasis).toContain('invoice-window and invoice-header dates for operational state');
    expect(reportingDateBasis).toContain('| Financial analytics and collections-style aggregates |');
    expect(reportingDateBasis).toContain('invoices.created_at');
    expect(reportingDateBasis).toContain('transactions.created_at');
  });

  it('T222: contract revenue, expiration, and reconciliation families use the documented date basis', () => {
    expect(reportingDateBasis).toContain('| Contract revenue reporting |');
    expect(reportingDateBasis).toContain('`invoice_charge_details.service_period_end` when canonical recurring detail rows exist');
    expect(reportingDateBasis).toContain('| Contract expiration and renewal-decision reporting |');
    expect(reportingDateBasis).toContain('`client_contracts.end_date` and renewal `decision_due_date`');
    expect(reportingDateBasis).toContain('| Credit reconciliation and discrepancy reporting |');
    expect(reportingDateBasis).toContain('`credit_reconciliation_reports.detection_date`');
    expect(contractReportActionsSource).toContain('Contract revenue is the report family that intentionally pivots to');
    expect(reconciliationReportActionsSource).toContain('Reconciliation reporting remains discrepancy-status and financial-date');
  });

  it('T223: financial analytics remain explicitly invoice-date and transaction-date based when mixed cadence can diverge from coverage dates', () => {
    expect(reportingDateBasis).toContain('no recurring service-period fallback unless a later analytics plan explicitly redefines that metric');
    expect(reportingDateBasis).toContain('financial-operational surfaces keep their invoice-header or transaction-date basis');
    expect(financialServiceSource).toContain('Financial analytics intentionally stay on invoice / transaction document');
    expect(financialServiceSource).toContain('coverage-based metrics belong in recurring readers');
  });

  it('T230: portal and dashboard metrics are split by intended date basis instead of silently inheriting invoice-header assumptions', () => {
    expect(reportingDateBasis).toContain('Recent invoice activity is one of the portal surfaces');
    expect(portalDashboardSource).toContain('Recent invoice activity is one of the portal surfaces that is allowed to');
    expect(portalDashboardSource).toContain('Pending invoice counts remain financial-document / invoice-state');
  });
});
