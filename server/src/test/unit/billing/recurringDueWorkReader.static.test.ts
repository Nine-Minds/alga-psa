import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../../../..');
const billingAndTaxSource = fs.readFileSync(
  path.join(repoRoot, 'packages/billing/src/actions/billingAndTax.ts'),
  'utf8',
);
const billingEngineSource = fs.readFileSync(
  path.join(repoRoot, 'packages/billing/src/lib/billing/billingEngine.ts'),
  'utf8',
);

describe('recurring due-work reader source', () => {
  it('T001: recurring due-work reader does not merge synthesized client_billing_cycles rows into ready recurring work', () => {
    expect(billingAndTaxSource).not.toContain('mergeRecurringDueWorkRows');
    expect(billingAndTaxSource).not.toContain('buildClientScheduleDueWorkRow');
    expect(billingAndTaxSource).toContain('rows: persistedRows.slice(offset, offset + pageSize)');
  });

  it('T005: recurring due-work code no longer accepts missing-table or missing-column schema fallback paths', () => {
    expect(billingAndTaxSource).not.toContain('POSTGRES_UNDEFINED_TABLE');
    expect(billingAndTaxSource).not.toContain('POSTGRES_UNDEFINED_COLUMN');
    expect(billingAndTaxSource).not.toContain('isMissingRecurringDueWorkRelation');
    expect(billingEngineSource).not.toContain('isMissingPersistedServicePeriodRelation');
    expect(billingEngineSource).not.toContain('POSTGRES_UNDEFINED_TABLE');
    expect(billingEngineSource).not.toContain('POSTGRES_UNDEFINED_COLUMN');
  });
});
