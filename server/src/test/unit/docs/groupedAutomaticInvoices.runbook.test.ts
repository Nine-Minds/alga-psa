import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../../../..');
const runbookPath = path.join(
  repoRoot,
  'ee/docs/plans/2026-03-20-grouped-automatic-invoices-selection/RUNBOOK.md',
);
const automaticInvoicesPath = path.join(
  repoRoot,
  'packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx',
);

describe('grouped automatic invoices runbook and copy contract', () => {
  it('T034: docs and in-product copy describe parent grouping, disabled non-combinable parents, and smart Select All semantics', () => {
    const runbook = fs.readFileSync(runbookPath, 'utf8');
    const automaticInvoicesSource = fs.readFileSync(automaticInvoicesPath, 'utf8');

    expect(runbook).toContain('parent rows are grouped by `client + invoice window`');
    expect(runbook).toContain('parent checkbox is disabled');
    expect(runbook).toContain('for combinable groups: select the parent row');
    expect(runbook).toContain('for non-combinable groups: select child rows individually');

    expect(automaticInvoicesSource).toContain('Each parent row groups due obligations by client and invoice window. Child obligations remain the atomic execution units.');
    expect(automaticInvoicesSource).toContain('Select All chooses parent rows when a group is combinable and falls back to individual child rows when a group is not combinable.');
  });
});
