import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions evergreen mark-renewing wiring', () => {
  it('allows evergreen queue rows to use mark-renewing status transition', () => {
    expect(source).toContain("contract_type: row.end_date ? ('fixed-term' as const) : ('evergreen' as const)");
    expect(source).toContain("return ['mark_renewing', 'mark_non_renewing', 'create_renewal_draft', 'snooze', 'assign_owner'];");

    const markRenewingSection = source
      .split('export const markRenewalQueueItemRenewing = withAuth(async (')[1]
      ?.split('export const markRenewalQueueItemNonRenewing = withAuth(async (')[0] ?? '';

    expect(markRenewingSection).toContain("if (previousStatus !== 'pending' && previousStatus !== 'non_renewing' && previousStatus !== 'snoozed') {");
    expect(markRenewingSection).toContain("status: 'renewing',");
    expect(markRenewingSection).not.toContain('end_date');
    expect(markRenewingSection).not.toContain('contract_type');
  });
});
