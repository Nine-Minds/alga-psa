import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../../../..');
const billingCycleActionsPath = path.join(
  repoRoot,
  'packages/billing/src/actions/billingCycleActions.ts',
);
const automaticInvoicesPath = path.join(
  repoRoot,
  'packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx',
);

describe('recurring invoice history naming', () => {
  it('T037: billing-cycle-specific recurring history action names are removed from the live AutomaticInvoices surface', () => {
    const actionsSource = fs.readFileSync(billingCycleActionsPath, 'utf8');
    const automaticInvoicesSource = fs.readFileSync(automaticInvoicesPath, 'utf8');

    expect(actionsSource).toContain('export const getRecurringInvoiceHistoryPaginated');
    expect(actionsSource).not.toContain(
      "coalesce(rsp_summary.cadence_owner, case when i.billing_cycle_id is not null then 'client' else null end) as cadence_owner"
    );
    expect(actionsSource).toContain('ARRAY[]::uuid[]) as assignment_contract_ids');
    expect(actionsSource).not.toContain('ARRAY[]::text[]) as assignment_contract_ids');
    expect(automaticInvoicesSource).toContain('getRecurringInvoiceHistoryPaginated');
    expect(automaticInvoicesSource).toContain('Recurring Invoice History');
    expect(automaticInvoicesSource).not.toContain('Already Invoiced');
    expect(automaticInvoicesSource).not.toContain('Reverse Billing Cycle');
  });
});
