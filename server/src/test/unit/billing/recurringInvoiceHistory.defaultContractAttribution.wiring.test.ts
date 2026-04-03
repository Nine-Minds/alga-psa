import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readRepo = (relativePath: string): string =>
  readFileSync(resolve(__dirname, '../../../../../', relativePath), 'utf8');

describe('recurring invoice history default-contract attribution wiring', () => {
  it('F065: history mapping tracks system-managed default vs explicit assignment context', () => {
    const source = readRepo('packages/billing/src/actions/billingCycleActions.ts');

    expect(source).toContain('assignment_default_contract_ids');
    expect(source).toContain('assignment_explicit_contract_ids');
    expect(source).toContain('assignmentSourceSummary');
    expect(source).toContain('System-managed default contract');
    expect(source).toContain('Explicit contract assignment');
    expect(source).toContain('Mixed assignment');
  });
});
