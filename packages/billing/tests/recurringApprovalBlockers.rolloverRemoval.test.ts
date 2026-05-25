import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

import { formatApprovalBlockedReason } from '../src/actions/recurringApprovalBlockers';

const invoiceGenerationSource = readFileSync(
  resolve(__dirname, '../src/actions/invoiceGeneration.ts'),
  'utf8',
);
const billingEngineSource = readFileSync(
  resolve(__dirname, '../src/lib/billing/billingEngine.ts'),
  'utf8',
);

describe('recurring approval blockers and rollover removal', () => {
  it('T001: recurring invoice generation no longer includes unapproved-time rollover mutation hooks', () => {
    expect(invoiceGenerationSource).not.toContain('rolloverUnapprovedTime(');
    expect(billingEngineSource).not.toContain('async rolloverUnapprovedTime(');
  });

  it('T002: matching unapproved recurring time still yields descriptive approval-blocked reason text', () => {
    expect(formatApprovalBlockedReason(1)).toBe('Blocked until approval: 1 unapproved entry.');
    expect(formatApprovalBlockedReason(3)).toBe('Blocked until approval: 3 unapproved entries.');
  });
});
