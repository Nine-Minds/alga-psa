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
const cutoverSequence = read('CUTOVER_SEQUENCE.md');
const featureSubsystemMap = read('FEATURE_SUBSYSTEM_MAP.md');
const persistedServicePeriodRecord = read('PERSISTED_SERVICE_PERIOD_RECORD.md');
const prd = read('PRD.md');
const recurringServicePeriodGenerationHorizon = read('RECURRING_SERVICE_PERIOD_GENERATION_HORIZON.md');
const recurringServicePeriodBackfill = read('RECURRING_SERVICE_PERIOD_BACKFILL.md');
const recurringServicePeriodEditOperations = read('RECURRING_SERVICE_PERIOD_EDIT_OPERATIONS.md');
const recurringServicePeriodDueSelection = read('RECURRING_SERVICE_PERIOD_DUE_SELECTION.md');
const recurringServicePeriodInvoiceLinkage = read('RECURRING_SERVICE_PERIOD_INVOICE_LINKAGE.md');
const recurringServicePeriodLifecycle = read('RECURRING_SERVICE_PERIOD_LIFECYCLE.md');
const recurringServicePeriodImmutability = read('RECURRING_SERVICE_PERIOD_IMMUTABILITY.md');
const recurringServicePeriodParityComparison = read('RECURRING_SERVICE_PERIOD_PARITY_COMPARISON.md');
const recurringServicePeriodProvenance = read('RECURRING_SERVICE_PERIOD_PROVENANCE.md');
const recurringServicePeriodRegeneration = read('RECURRING_SERVICE_PERIOD_REGENERATION.md');
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

  it('T258: persisted recurring execution records remain explicitly out of scope unless their follow-on boundary is invoked', () => {
    expect(prd).toContain('## Follow-on Boundary — Persisted Recurring Execution Records');
    expect(prd).toContain('persisted recurring run records keyed by execution-window identity');
    expect(prd).toContain('durable selection snapshots for every due-work batch');
    expect(appendix).toContain('## Follow-On Boundary — Persisted Recurring Execution Records');
    expect(appendix).toContain('It does not automatically include a durable recurring-run ledger or persisted due-selection snapshots.');
    expect(appendix).toContain('rollback posture when some tenants have durable recurring execution records and others still rely on transient scheduler metadata');
  });

  it('T259: invoice-schema versioning remains explicitly out of scope unless its follow-on boundary is invoked', () => {
    expect(prd).toContain('## Follow-on Boundary — Invoice-Schema Versioning');
    expect(prd).toContain('dual old-shape and new-shape invoice support additive');
    expect(prd).toContain('explicit invoice payload version markers for API or export consumers');
    expect(appendix).toContain('## Follow-On Boundary — Invoice-Schema Versioning');
    expect(appendix).toContain('Recurring v1 keeps old-shape and new-shape invoice support additive.');
    expect(appendix).toContain('whether versioning applies only at API boundaries or also to stored export, workflow, and audit projections');
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

  it('T286 and T294: backfill policy initializes only future persisted rows and keeps billed history outside mutation scope', () => {
    expect(recurringServicePeriodBackfill).toContain('# Recurring Service-Period Backfill');
    expect(recurringServicePeriodBackfill).toContain('## Historical Boundary');
    expect(recurringServicePeriodBackfill).toContain('legacyBilledThroughEnd');
    expect(recurringServicePeriodBackfill).toContain('candidate periods ending on or before the boundary are skipped');
    expect(recurringServicePeriodBackfill).toContain('candidate that overlaps the boundary is rejected');
    expect(recurringServicePeriodBackfill).toContain('## Initialization Policy');
    expect(recurringServicePeriodBackfill).toContain('`provenance.reasonCode = backfill_materialization`');
    expect(recurringServicePeriodBackfill).toContain('## Existing Future Rows');
    expect(recurringServicePeriodBackfill).toContain('`reasonCode = backfill_realignment`');
    expect(recurringServicePeriodBackfill).toContain('shared/billingClients/backfillRecurringServicePeriods.ts');
    expect(persistedServicePeriodRecord).toContain('## Backfill Boundary');
    expect(persistedServicePeriodRecord).toContain('already billed historical coverage stays authoritative on invoice detail history');
  });

  it('T345: boundary adjustment remains part of the minimal v1 edit surface before continuity and UI passes land', () => {
    expect(recurringServicePeriodEditOperations).toContain('# Recurring Service-Period Edit Operations');
    expect(recurringServicePeriodEditOperations).toContain('## Minimal Supported Operations');
    expect(recurringServicePeriodEditOperations).toContain('`boundary_adjustment`');
    expect(recurringServicePeriodEditOperations).toContain('shared/billingClients/editRecurringServicePeriodBoundaries.ts');
    expect(recurringServicePeriodEditOperations).toContain('## Revision And Provenance Rule');
    expect(recurringServicePeriodEditOperations).toContain('`lifecycleState = superseded`');
    expect(recurringServicePeriodEditOperations).toContain('`lifecycleState = edited`');
    expect(recurringServicePeriodEditOperations).toContain('`invoice_window_adjustment`');
    expect(recurringServicePeriodEditOperations).toContain('`activity_window_adjustment`');
    expect(recurringServicePeriodEditOperations).toContain('## Minimal Local Validation');
    expect(recurringServicePeriodEditOperations).toContain('billed or locked rows remain non-editable in place');
  });

  it('T346: skip and defer are defined as explicit superseding revisions rather than in-place state toggles', () => {
    expect(recurringServicePeriodEditOperations).toContain('`skip`');
    expect(recurringServicePeriodEditOperations).toContain('`defer`');
    expect(recurringServicePeriodEditOperations).toContain('shared/billingClients/skipOrDeferRecurringServicePeriod.ts');
    expect(recurringServicePeriodEditOperations).toContain('`lifecycleState = skipped`');
    expect(recurringServicePeriodEditOperations).toContain('`reasonCode = skip`');
    expect(recurringServicePeriodEditOperations).toContain('`reasonCode = defer`');
    expect(recurringServicePeriodEditOperations).toContain('defer must supply a new invoice window');
  });

  it('T347: split and merge remain explicitly unsupported in v1', () => {
    expect(recurringServicePeriodEditOperations).toContain('## Unsupported In V1');
    expect(recurringServicePeriodEditOperations).toContain('Split and merge are explicitly not supported in v1.');
    expect(recurringServicePeriodEditOperations).toContain('shared/billingClients/recurringServicePeriodEditCapabilities.ts');
    expect(recurringServicePeriodEditOperations).toContain('supported v1 edit operations are `boundary_adjustment`, `skip`, and `defer`');
    expect(recurringServicePeriodEditOperations).toContain('`split` and `merge` fail fast as unsupported v1 operations');
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

  it('documents the authoritative persisted service-period record contract for materialized recurring billing', () => {
    expect(persistedServicePeriodRecord).toContain('# Persisted Service-Period Record');
    expect(persistedServicePeriodRecord).toContain('## Record Identity');
    expect(persistedServicePeriodRecord).toContain('recordId');
    expect(persistedServicePeriodRecord).toContain('scheduleKey');
    expect(persistedServicePeriodRecord).toContain('periodKey');
    expect(persistedServicePeriodRecord).toContain('## Obligation And Cadence Linkage');
    expect(persistedServicePeriodRecord).toContain('IPersistedRecurringObligationRef');
    expect(persistedServicePeriodRecord).toContain('## Boundary Contract');
    expect(persistedServicePeriodRecord).toContain('servicePeriod');
    expect(persistedServicePeriodRecord).toContain('invoiceWindow');
    expect(persistedServicePeriodRecord).toContain('## Provenance And Lifecycle');
    expect(persistedServicePeriodRecord).toContain('RecurringServicePeriodLifecycleState');
    expect(persistedServicePeriodRecord).toContain('RecurringServicePeriodProvenanceKind');
    expect(persistedServicePeriodRecord).toContain('F232');
    expect(persistedServicePeriodRecord).toContain('F233-F255');
  });

  it('documents the recurring service-period lifecycle states, allowed transitions, and terminal-state policy', () => {
    expect(recurringServicePeriodLifecycle).toContain('# Recurring Service-Period Lifecycle');
    expect(recurringServicePeriodLifecycle).toContain('## State Meanings');
    expect(recurringServicePeriodLifecycle).toContain('`generated`');
    expect(recurringServicePeriodLifecycle).toContain('`edited`');
    expect(recurringServicePeriodLifecycle).toContain('`skipped`');
    expect(recurringServicePeriodLifecycle).toContain('`locked`');
    expect(recurringServicePeriodLifecycle).toContain('`billed`');
    expect(recurringServicePeriodLifecycle).toContain('`superseded`');
    expect(recurringServicePeriodLifecycle).toContain('`archived`');
    expect(recurringServicePeriodLifecycle).toContain('## Allowed Transitions');
    expect(recurringServicePeriodLifecycle).toContain('generated -> edited | skipped | locked | billed | superseded | archived');
    expect(recurringServicePeriodLifecycle).toContain('billed -> archived');
    expect(recurringServicePeriodLifecycle).toContain('## Terminal States');
    expect(recurringServicePeriodLifecycle).toContain('shared/billingClients/recurringServicePeriodLifecycle.ts');
  });

  it('documents the recurring service-period invoice linkage contract and billed-history traceability boundary', () => {
    expect(recurringServicePeriodInvoiceLinkage).toContain('# Recurring Service-Period Invoice Linkage');
    expect(recurringServicePeriodInvoiceLinkage).toContain('## Linkage Shape');
    expect(recurringServicePeriodInvoiceLinkage).toContain('invoiceChargeDetailId');
    expect(recurringServicePeriodInvoiceLinkage).toContain('`invoice_charge_details.item_detail_id` remains the canonical recurring detail identity');
    expect(recurringServicePeriodInvoiceLinkage).toContain('## Lifecycle Effect');
    expect(recurringServicePeriodInvoiceLinkage).toContain('lifecycleState = billed');
    expect(recurringServicePeriodInvoiceLinkage).toContain('invoice_linkage_repair');
    expect(recurringServicePeriodInvoiceLinkage).toContain('shared/billingClients/recurringServicePeriodInvoiceLinkage.ts');
    expect(recurringServicePeriodInvoiceLinkage).toContain('server/migrations/20260318143000_add_invoice_linkage_to_recurring_service_periods.cjs');
    expect(persistedServicePeriodRecord).toContain('RECURRING_SERVICE_PERIOD_INVOICE_LINKAGE.md');
  });

  it('documents the persisted recurring service-period due-selection query contract and its runtime-cutover boundary', () => {
    expect(recurringServicePeriodDueSelection).toContain('# Recurring Service-Period Due Selection');
    expect(recurringServicePeriodDueSelection).toContain('## Query Inputs');
    expect(recurringServicePeriodDueSelection).toContain('resolved `scheduleKeys[]` scope');
    expect(recurringServicePeriodDueSelection).toContain('## Eligibility Rules');
    expect(recurringServicePeriodDueSelection).toContain('only `generated`, `edited`, and `locked` rows are eligible by default');
    expect(recurringServicePeriodDueSelection).toContain('rows with existing `invoiceLinkage` are excluded');
    expect(recurringServicePeriodDueSelection).toContain('## Ordering');
    expect(recurringServicePeriodDueSelection).toContain('shared/billingClients/recurringServicePeriodDueSelection.ts');
    expect(recurringServicePeriodDueSelection).toContain('`F256` is still the later pass');
  });

  it('documents persisted schedule parity comparison between legacy derived timing and materialized service-period schedules', () => {
    expect(recurringServicePeriodParityComparison).toContain('# Recurring Service-Period Parity Comparison');
    expect(recurringServicePeriodParityComparison).toContain('## Normalized Identity');
    expect(recurringServicePeriodParityComparison).toContain('`scheduleKey`');
    expect(recurringServicePeriodParityComparison).toContain('`periodKey`');
    expect(recurringServicePeriodParityComparison).toContain('shared/billingClients/recurringServicePeriodKeys.ts');
    expect(recurringServicePeriodParityComparison).toContain('## Drift Types');
    expect(recurringServicePeriodParityComparison).toContain('`missing_persisted_period`');
    expect(recurringServicePeriodParityComparison).toContain('`unexpected_persisted_period`');
    expect(recurringServicePeriodParityComparison).toContain('`invoice_window_mismatch`');
    expect(recurringServicePeriodParityComparison).toContain('shared/billingClients/recurringServicePeriodParity.ts');
  });

  it('T284: documents the persisted provenance model for generated, user-edited, regenerated, and repair rows', () => {
    expect(recurringServicePeriodProvenance).toContain('# Recurring Service-Period Provenance');
    expect(recurringServicePeriodProvenance).toContain('## Provenance Kinds');
    expect(recurringServicePeriodProvenance).toContain('| `generated` |');
    expect(recurringServicePeriodProvenance).toContain('| `user_edited` |');
    expect(recurringServicePeriodProvenance).toContain('| `regenerated` |');
    expect(recurringServicePeriodProvenance).toContain('| `repair` |');
    expect(recurringServicePeriodProvenance).toContain('## Field Requirements By Kind');
    expect(recurringServicePeriodProvenance).toContain('Generated provenance requires sourceRunKey');
    expect(recurringServicePeriodProvenance).toContain('`boundary_adjustment`');
    expect(recurringServicePeriodProvenance).toContain('`billing_schedule_changed`');
    expect(recurringServicePeriodProvenance).toContain('shared/billingClients/recurringServicePeriodProvenance.ts');
    expect(persistedServicePeriodRecord).toContain('RECURRING_SERVICE_PERIOD_PROVENANCE.md');
  });

  it('T285: documents the v1 generation horizon, replenishment threshold, and continuity policy for future persisted service periods', () => {
    expect(recurringServicePeriodGenerationHorizon).toContain('# Recurring Service-Period Generation Horizon');
    expect(recurringServicePeriodGenerationHorizon).toContain('target future coverage window: `180` days');
    expect(recurringServicePeriodGenerationHorizon).toContain('low-water replenishment threshold: `45` days');
    expect(recurringServicePeriodGenerationHorizon).toContain('initial materialization or backfill should keep generating');
    expect(recurringServicePeriodGenerationHorizon).toContain('steady-state maintenance should replenish');
    expect(recurringServicePeriodGenerationHorizon).toContain('## Continuity Rule');
    expect(recurringServicePeriodGenerationHorizon).toContain('`gap`');
    expect(recurringServicePeriodGenerationHorizon).toContain('`overlap`');
    expect(recurringServicePeriodGenerationHorizon).toContain('shared/billingClients/recurringServicePeriodGenerationHorizon.ts');
  });

  it('T288 and T289: documents regeneration of untouched future rows and explicit preservation of edited overrides', () => {
    expect(recurringServicePeriodRegeneration).toContain('# Recurring Service-Period Regeneration');
    expect(recurringServicePeriodRegeneration).toContain('untouched generated future rows may be refreshed');
    expect(recurringServicePeriodRegeneration).toContain('user-edited or repair-driven future rows must not be silently overwritten');
    expect(recurringServicePeriodRegeneration).toContain('by reusing the prior `periodKey` and incrementing `revision`');
    expect(recurringServicePeriodRegeneration).toContain('provenance.kind = user_edited');
    expect(recurringServicePeriodRegeneration).toContain('provenance.kind = repair');
    expect(recurringServicePeriodRegeneration).toContain('shared/billingClients/regenerateRecurringServicePeriods.ts');
  });

  it('T290: documents immutability for locked or billed service periods and the narrow corrective-flow boundary', () => {
    expect(recurringServicePeriodImmutability).toContain('# Recurring Service-Period Immutability');
    expect(recurringServicePeriodImmutability).toContain('locked or billed rows are immutable in place');
    expect(recurringServicePeriodImmutability).toContain('invoice_linkage_repair');
    expect(recurringServicePeriodImmutability).toContain('edit_boundaries');
    expect(recurringServicePeriodImmutability).toContain('shared/billingClients/recurringServicePeriodMutations.ts');
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

  it('T253: reader-first then writer and scheduler cutover stages stay explicit for coexistence safety', () => {
    expect(cutoverSequence).toContain('# Cutover Sequence');
    expect(cutoverSequence).toContain('## Reader-First Core Cutover');
    expect(cutoverSequence).toContain('### Stage A — Reader compatibility before writer cutover');
    expect(cutoverSequence).toContain('### Stage B — Writer cutover after reader compatibility');
    expect(cutoverSequence).toContain('### Stage C — Scheduler identity cutover after reader and writer stability');
    expect(cutoverSequence).toContain('### Stage D — Grouping and invoice-candidate policy cutover');
    expect(cutoverSequence).toContain('### Stage E — Contract-cadence tenant enablement');
  });

  it('T254: reporting, portal, and export cutover order stays explicit after the canonical invoice read-model lands', () => {
    expect(cutoverSequence).toContain('## Downstream Consumer Cutover');
    expect(cutoverSequence).toContain('### Portal and dashboard readers');
    expect(cutoverSequence).toContain('### Reporting families');
    expect(cutoverSequence).toContain('### Accounting export readers and adapters');
    expect(cutoverSequence).toContain('Export adapters are the last downstream step');
  });

  it('T255: rollback posture remains explicit while historical flat invoices and canonical detail-backed invoices coexist', () => {
    expect(cutoverSequence).toContain('## Rollback And Coexistence');
    expect(cutoverSequence).toContain('Historical flat invoices and canonical detail-backed invoices will remain queryable together for an extended period.');
    expect(cutoverSequence).toContain('must not delete canonical `invoice_charge_details`');
    expect(cutoverSequence).toContain('must not force contract-cadence identities back through fake `billingCycleId` bridges');
    expect(cutoverSequence).toContain('Keep dual-shape invoice schema support until product explicitly decides that historical flat readers can be removed.');
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

  it('T256: projection-mismatch runbook stays explicit enough to diagnose header-versus-detail disagreements', () => {
    expect(runbook).toContain('## Projection Mismatch Investigation');
    expect(runbook).toContain('confirm whether the invoice charge has `invoice_charge_details` rows');
    expect(runbook).toContain('parent_service_period_start');
    expect(runbook).toContain('canonical_detail_start');
    expect(runbook).toContain('if `detail_period_count > 0`, canonical recurring detail periods remain authoritative');
  });

  it('T257: authoring-default drift runbook stays explicit enough to diagnose divergence across templates, presets, and live authoring paths', () => {
    expect(runbook).toContain('## Authoring-Default Drift Investigation');
    expect(runbook).toContain('contract wizard');
    expect(runbook).toContain('preset create or reuse');
    expect(runbook).toContain('template_billing_timing');
    expect(runbook).toContain('legacy compatibility fields may still exist, but they must not be the reason a live recurring line silently changes cadence or timing');
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
