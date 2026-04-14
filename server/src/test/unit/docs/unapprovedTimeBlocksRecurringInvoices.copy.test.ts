import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../../../..');
const runbookPath = path.join(
  repoRoot,
  'ee/docs/plans/2026-04-12-unapproved-time-blocks-recurring-invoices/RUNBOOK.md',
);
const automaticInvoicesPath = path.join(
  repoRoot,
  'packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx',
);

describe('unapproved recurring windows copy contract', () => {
  it('T012: docs and in-product copy state that the full invoice window is blocked until billable time is approved', () => {
    const runbook = fs.readFileSync(runbookPath, 'utf8');
    const automaticInvoicesSource = fs.readFileSync(automaticInvoicesPath, 'utf8');

    expect(runbook).toContain('The whole invoice window is blocked until the billable time is approved');
    expect(runbook).toContain('Blocked until approval: 3 unapproved entries.');

    expect(automaticInvoicesSource).toContain('Needs Approval');
    expect(automaticInvoicesSource).toContain('The entire invoice window is blocked until approvals are complete.');
    expect(automaticInvoicesSource).toContain('Review Approvals');
  });
});
