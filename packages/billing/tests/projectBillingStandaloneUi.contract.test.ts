// @vitest-environment node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');
const readRepo = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), 'utf8');

const reviewTab = readRepo(
  'packages/billing/src/components/billing-dashboard/invoicing/ProjectBillingReviewTab.tsx',
);
const projectBillingView = readRepo(
  'packages/billing/src/components/project-billing/ProjectBillingView.tsx',
);

describe('standalone project billing UI contract', () => {
  it('offers standalone review rows only the approve-and-invoice path', () => {
    expect(reviewTab).toContain("record.invoice_mode === 'recurring' && (");
    expect(reviewTab).toContain("record.invoice_mode === 'standalone' && (");
    expect(reviewTab).toContain("selectedRows.every((row) => row.invoice_mode === 'recurring')");
    expect(reviewTab).toContain('...(canBulkApproveSelection');
  });

  it('offers invoice generation for every manageable standalone project', () => {
    const generateAction = "config.invoice_mode === 'standalone' && canManage";
    expect(projectBillingView).toContain(generateAction);
    expect(projectBillingView.indexOf(generateAction)).toBeLessThan(
      projectBillingView.indexOf('{isFixed ? ('),
    );
    expect(projectBillingView).toContain('id="billing-generate-project-invoice"');
    expect(projectBillingView).toContain('onClick={handleGenerateProjectInvoice}');
  });
});
