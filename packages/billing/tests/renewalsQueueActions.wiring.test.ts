import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions wiring', () => {
  it('exports a list action that maps normalized contract assignments into queue rows', () => {
    expect(source).toContain("import type { RenewalWorkItemStatus } from '@alga-psa/types';");
    expect(source).toContain('const DEFAULT_RENEWALS_HORIZON_DAYS = 90;');
    expect(source).toContain("export type RenewalQueueAction =");
    expect(source).toContain('const getAvailableActionsForStatus = (status: RenewalWorkItemStatus): RenewalQueueAction[] => {');
    expect(source).toContain('const RENEWAL_WORK_ITEM_STATUSES: RenewalWorkItemStatus[] = [');
    expect(source).toContain("const isRenewalWorkItemStatus = (value: unknown): value is RenewalWorkItemStatus =>");
    expect(source).toContain("const toRenewalWorkItemStatus = (value: unknown): RenewalWorkItemStatus =>");
    expect(source).toContain("export const listRenewalQueueRows = withAuth(async (");
    expect(source).toContain('horizonDays: number = DEFAULT_RENEWALS_HORIZON_DAYS');
    expect(source).toContain(".map(normalizeClientContract)");
    expect(source).toContain('.filter(');
    expect(source).toContain('Boolean(row.decision_due_date)');
    expect(source).toContain('row.days_until_due >= 0');
    expect(source).toContain('row.days_until_due <= resolvedHorizonDays');
    expect(source).toContain('assigned_to: (row as any).assigned_to ?? null');
    expect(source).toContain('effective_renewal_mode: row.effective_renewal_mode');
    expect(source).toContain('status: toRenewalWorkItemStatus((row as any).status),');
    expect(source).toContain('created_draft_contract_id: (row as any).created_draft_contract_id ?? null,');
    expect(source).toContain('available_actions: getAvailableActionsForStatus(toRenewalWorkItemStatus((row as any).status)),');
    expect(source).toContain("contract_type: row.end_date ? ('fixed-term' as const) : ('evergreen' as const)");
    expect(source).toContain(".sort((a, b) => (a.decision_due_date ?? '').localeCompare(b.decision_due_date ?? ''));");
  });
});
