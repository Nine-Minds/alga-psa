import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

// Resolve relative to this test file so the suite passes regardless of the
// runner's working directory (server/ vs packages/billing).
const companySyncSource = readFileSync(
  new URL('../src/services/companySync/companySyncService.ts', import.meta.url),
  'utf8'
);
const mappingResolverSource = readFileSync(
  new URL('../src/services/accountingMappingResolver.ts', import.meta.url),
  'utf8'
);
const exportValidationSource = readFileSync(
  new URL('../src/services/accountingExportValidation.ts', import.meta.url),
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
