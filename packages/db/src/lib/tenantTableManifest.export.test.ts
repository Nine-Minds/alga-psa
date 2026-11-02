import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TENANT_TABLE_MANIFEST, tenantExportOrder } from './tenantTableManifest';

describe('tenant export order', () => {
  it('is the declared export ranks, 48 unique names', () => {
    const order = tenantExportOrder();
    expect(order).toHaveLength(48);
    expect(new Set(order).size).toBe(48);
    expect(order.every(t => TENANT_TABLE_MANIFEST.some(e => e.table === t))).toBe(true);
  });

  it('is what tenant-export.ts reads, and the literal list is gone', () => {
    const src = readFileSync(path.resolve(__dirname, '../../../../ee/server/src/lib/tenant-management/tenant-export.ts'), 'utf-8');
    expect(src).toContain('tenantExportOrder()');
    expect(src).not.toMatch(/TENANT_TABLES_EXPORT_ORDER\s*[:=]/);
  });
});
