import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const companySyncSource = readFileSync(
  path.resolve(process.cwd(), '../packages/billing/src/services/companySync/companySyncService.ts'),
  'utf8'
);
const mappingResolverSource = readFileSync(
  path.resolve(process.cwd(), '../packages/billing/src/services/accountingMappingResolver.ts'),
  'utf8'
);
const exportValidationSource = readFileSync(
  path.resolve(process.cwd(), '../packages/billing/src/services/accountingExportValidation.ts'),
  'utf8'
);

describe('accounting service-period audit wiring', () => {
  it('keeps company sync and accounting mapping period-agnostic', () => {
    expect(companySyncSource).not.toContain('billing_period_start');
    expect(companySyncSource).not.toContain('billing_period_end');
    expect(companySyncSource).not.toContain('service_period_start');
    expect(companySyncSource).not.toContain('service_period_end');

    expect(mappingResolverSource).not.toContain('billing_period_start');
    expect(mappingResolverSource).not.toContain('billing_period_end');
    expect(mappingResolverSource).not.toContain('service_period_start');
    expect(mappingResolverSource).not.toContain('service_period_end');
  });

  it('preserves canonical export-line periods inside accounting export validation errors', () => {
    expect(exportValidationSource).toContain('Company sync and mapping resolution stay period-agnostic');
    expect(exportValidationSource).toContain('mergeErrorMetadata(line');
    expect(exportValidationSource).toContain('service_period_projection_mismatch');
    expect(exportValidationSource).toContain('service_period_start');
    expect(exportValidationSource).toContain('service_period_end');
    expect(exportValidationSource).not.toContain('billing_period_start');
    expect(exportValidationSource).not.toContain('billing_period_end');
  });
});
