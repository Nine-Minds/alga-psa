import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const invoiceServiceSource = fs.readFileSync(
  path.join(repoRoot, '../packages/billing/src/services/invoiceService.ts'),
  'utf8',
);

describe('recurring invoice linkage source guards', () => {
  it('T031: recurring invoice linkage no longer widens or narrows candidate matching from invoice.billing_cycle_id', () => {
    expect(invoiceServiceSource).toContain("first(['billing_period_start', 'billing_period_end'])");
    expect(invoiceServiceSource).not.toContain('billing_cycle_id');
    expect(invoiceServiceSource).not.toContain('obligationTypeFilter');
    expect(invoiceServiceSource).toContain('buildPostDropRecurringObligationCandidates({');
    expect(invoiceServiceSource).toContain('contractLineId: configRow.contract_line_id');
    expect(invoiceServiceSource).toContain('where(function recurringObligationMatch()');
  });

  it('T032: recurring invoice linkage no longer suppresses missing-relation fallback errors for bridge-era schema tolerance', () => {
    expect(invoiceServiceSource).not.toContain('isMissingRecurringLinkageRelationError');
    expect(invoiceServiceSource).not.toContain('relation .* does not exist');
    expect(invoiceServiceSource).not.toContain("code === '42P01'");
    expect(invoiceServiceSource).not.toContain("await tx('client_contract_lines')");
    expect(invoiceServiceSource).toContain('obligation_type: candidate.obligationType');
    expect(invoiceServiceSource).toContain('obligation_id: candidate.obligationId');
  });
});
