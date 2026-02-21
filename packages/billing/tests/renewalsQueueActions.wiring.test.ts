import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions wiring', () => {
  it('exports a list action that maps normalized contract assignments into queue rows', () => {
    expect(source).toContain("export const listRenewalQueueRows = withAuth(async (");
    expect(source).toContain(".map(normalizeClientContract)");
    expect(source).toContain(".filter((row) => Boolean(row.decision_due_date))");
    expect(source).toContain("contract_type: row.end_date ? 'fixed-term' : 'evergreen'");
  });
});
