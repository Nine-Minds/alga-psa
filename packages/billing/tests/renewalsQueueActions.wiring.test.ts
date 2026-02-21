import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions wiring', () => {
  it('exports a list action that maps normalized contract assignments into queue rows', () => {
    expect(source).toContain('const DEFAULT_RENEWALS_HORIZON_DAYS = 90;');
    expect(source).toContain("export const listRenewalQueueRows = withAuth(async (");
    expect(source).toContain('horizonDays: number = DEFAULT_RENEWALS_HORIZON_DAYS');
    expect(source).toContain(".map(normalizeClientContract)");
    expect(source).toContain('.filter(');
    expect(source).toContain('Boolean(row.decision_due_date)');
    expect(source).toContain('row.days_until_due >= 0');
    expect(source).toContain('row.days_until_due <= resolvedHorizonDays');
    expect(source).toContain('assigned_to: (row as any).assigned_to ?? null');
    expect(source).toContain('effective_renewal_mode: row.effective_renewal_mode');
    expect(source).toContain("(row as any).status === 'pending' ||");
    expect(source).toContain("(row as any).status === 'renewing' ||");
    expect(source).toContain("status:\n        (row as any).status === 'pending'");
    expect(source).toContain("contract_type: row.end_date ? 'fixed-term' : 'evergreen'");
  });
});
