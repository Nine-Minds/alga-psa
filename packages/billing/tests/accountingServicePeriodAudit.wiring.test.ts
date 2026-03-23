import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('F141 accounting service-period audit', () => {
  it('keeps company-sync and mapping resolution period-agnostic while export validation inspects canonical detail periods', () => {
    const companySyncSource = read('packages/billing/src/services/companySync/companySyncService.ts');
    const mappingResolverSource = read('packages/billing/src/services/accountingMappingResolver.ts');
    const exportValidationSource = read('packages/billing/src/services/accountingExportValidation.ts');

    expect(companySyncSource).not.toContain('billing_period_start');
    expect(companySyncSource).not.toContain('billing_period_end');
    expect(companySyncSource).not.toContain('service_period_start');
    expect(companySyncSource).not.toContain('service_period_end');

    expect(mappingResolverSource).not.toContain('billing_period_start');
    expect(mappingResolverSource).not.toContain('billing_period_end');
    expect(mappingResolverSource).not.toContain('service_period_start');
    expect(mappingResolverSource).not.toContain('service_period_end');

    expect(exportValidationSource).toContain('invoice_charge_details');
    expect(exportValidationSource).toContain('service_period_projection_mismatch');
  });
});
