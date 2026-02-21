import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/contractReportActions.ts', import.meta.url),
  'utf8'
);

describe('contractReportActions expiration report wiring', () => {
  it('exposes decision_due_date alongside end_date when available', () => {
    expect(source).toContain('export interface ContractExpiration {');
    expect(source).toContain('decision_due_date?: string | null;');
    expect(source).toContain("'cc.decision_due_date',");
    expect(source).toContain("decision_due_date: row.decision_due_date ? new Date(row.decision_due_date).toISOString().split('T')[0] : null,");
    expect(source).toContain('end_date: endDate.toISOString().split(\'T\')[0],');
  });

  it('includes renewal_mode in expiration report row payloads', () => {
    expect(source).toContain("renewal_mode?: 'none' | 'manual' | 'auto' | null;");
    expect(source).toContain("'cc.renewal_mode',");
    expect(source).toContain('renewal_mode: row.renewal_mode ?? null,');
  });

  it('includes queue status in expiration rows when work-item status exists', () => {
    expect(source).toContain("import type { RenewalWorkItemStatus } from '@alga-psa/types';");
    expect(source).toContain('queue_status?: RenewalWorkItemStatus | null;');
    expect(source).toContain("'cc.status as queue_status',");
    expect(source).toContain('queue_status: row.queue_status ?? null,');
  });
});
