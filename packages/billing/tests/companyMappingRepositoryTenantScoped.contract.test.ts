import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(__dirname, '../src/services/companySync/companyMappingRepository.ts'),
  'utf8'
);

describe('company mapping repository tenant-scoped query contract', () => {
  it('routes tenant external entity mapping roots through tenantDb', () => {
    expect(source).toContain("import { tenantDb } from '@alga-psa/db';");
    expect(source).toContain("tenantDb(trx, record.tenantId).table(TABLE_NAME).insert(payload)");
    expect(source).toContain('tenantDb(executor, params.tenantId).table(TABLE_NAME)');
    expect(source).not.toContain('trx(TABLE_NAME).insert');
    expect(source).not.toContain('executor(TABLE_NAME)');
    expect(source).not.toContain('tenant: params.tenantId');
  });
});
