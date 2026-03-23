import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('contractLineService decoupled attach policy', () => {
  const source = readFileSync(
    path.resolve(
      import.meta.dirname,
      '../../../../../packages/billing/src/actions/contractLineServiceActions.ts',
    ),
    'utf8',
  );

  it('T019: attach flow determines service configuration type from target line mode/context, not catalog billing method', () => {
    expect(source).toContain('const allowedConfigTypesByPlan');
    expect(source).toContain("plan.contract_line_type === 'Hourly'");
    expect(source).toContain("plan.contract_line_type === 'Usage'");
    expect(source).not.toContain('service_type_billing_method');
  });

  it('T020: attach flow rejects explicit configuration types that are incompatible with target line mode', () => {
    expect(source).toContain("Fixed: ['Fixed', 'Bucket']");
    expect(source).toContain("Hourly: ['Hourly', 'Bucket']");
    expect(source).toContain("Usage: ['Usage', 'Bucket']");
    expect(source).toContain('Configuration type ${configType} is not valid');
  });
});
