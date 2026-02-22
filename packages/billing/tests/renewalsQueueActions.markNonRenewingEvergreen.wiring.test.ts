import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions evergreen mark-non-renewing wiring', () => {
  it('allows evergreen queue rows to use mark-non-renewing status transition', () => {
    expect(source).toContain("contract_type: row.end_date ? ('fixed-term' as const) : ('evergreen' as const)");
    expect(source).toContain("return ['mark_renewing', 'mark_non_renewing', 'create_renewal_draft', 'snooze', 'assign_owner'];");

    const markNonRenewingSection = source
      .split('export const markRenewalQueueItemNonRenewing = withAuth(async (')[1]
      ?.split('export const createRenewalDraftForQueueItem = withAuth(async (')[0] ?? '';

    expect(markNonRenewingSection).toContain("if (previousStatus !== 'pending' && previousStatus !== 'renewing' && previousStatus !== 'snoozed') {");
    expect(markNonRenewingSection).toContain("status: 'non_renewing',");
    expect(markNonRenewingSection).not.toContain('end_date');
    expect(markNonRenewingSection).not.toContain('contract_type');
  });
});
