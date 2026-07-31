import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const invoiceServiceSource = fs.readFileSync(
  path.join(repoRoot, '../packages/billing/src/services/invoiceService.ts'),
  'utf8',
);

describe('recurring invoice linkage source guards', () => {
  it('T031: recurring invoice linkage matches the exact persisted service period record, never a reconstructed candidate set', () => {
    // The billing engine stamps the persisted recurring_service_periods.record_id
    // onto every recurring charge, so linkage is an identity lookup. There is no
    // candidate matching left to widen or narrow.
    expect(invoiceServiceSource).toContain('servicePeriodRecordId?: string | null;');
    expect(invoiceServiceSource).toContain('record_id: servicePeriodRecordId,');
    expect(invoiceServiceSource).not.toContain('billing_cycle_id');
    expect(invoiceServiceSource).not.toContain('obligationTypeFilter');
    expect(invoiceServiceSource).not.toContain('buildPostDropRecurringObligationCandidates({');
    expect(invoiceServiceSource).not.toContain('where(function recurringObligationMatch()');
    // Date-shaped re-derivation of the service period / invoice window was the
    // source of the prorated-period linkage bug; it must not come back.
    expect(invoiceServiceSource).not.toContain("first(['billing_period_start', 'billing_period_end'])");
    expect(invoiceServiceSource).not.toContain('normalizeRecurringDateForPersistence');
    expect(invoiceServiceSource).not.toContain('addUtcDayToDateOnly');
  });

  it('T032: recurring invoice linkage no longer suppresses missing-relation fallback errors for bridge-era schema tolerance', () => {
    expect(invoiceServiceSource).not.toContain('isMissingRecurringLinkageRelationError');
    expect(invoiceServiceSource).not.toContain('relation .* does not exist');
    expect(invoiceServiceSource).not.toContain("code === '42P01'");
    expect(invoiceServiceSource).not.toContain("await tx('client_contract_lines')");
  });

  it('T033: a recurring charge that fails to link its service period aborts invoice generation', () => {
    // Silent non-linkage left prorated periods stuck in `generated` and let the
    // same period be billed twice; the linkage must be asserted, not best-effort.
    expect(invoiceServiceSource).toContain('function assertRecurringPeriodLinked(params: {');
    expect(invoiceServiceSource).toContain('is missing servicePeriodRecordId.');
    expect(invoiceServiceSource).toContain('if (params.updatedCount !== 1) {');
    expect(invoiceServiceSource).toContain("lifecycle_state: 'billed',");
    expect(invoiceServiceSource).toContain("whereIn('lifecycle_state', ['generated', 'edited', 'locked'])");
    expect(invoiceServiceSource).toContain("whereNull('invoice_charge_detail_id')");
  });
});
