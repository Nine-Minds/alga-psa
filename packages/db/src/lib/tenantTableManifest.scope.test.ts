import { describe, expect, it } from 'vitest';
import { TENANT_TABLE_MANIFEST } from './tenantTableManifest';
import { tenantTableMetadata } from './tenantTableMetadata';

describe('tenant table manifest scope', () => {
  it('every entry resolves via tenantTableMetadata or declares a scope (excluded entries need a reason)', () => {
    for (const entry of TENANT_TABLE_MANIFEST) {
      if (entry.deletion === 'excluded') {
        expect(entry.reason, `${entry.table} exclusion reason`).toBeTruthy();
        continue;
      }
      expect(Boolean(tenantTableMetadata[entry.table] || entry.scope), `${entry.table} scope`).toBe(true);
    }
  });

  it('lists the metadata-less entries explicitly (18)', () => {
    const declared = TENANT_TABLE_MANIFEST
      .filter(e => e.deletion !== 'excluded' && !tenantTableMetadata[e.table])
      .map(e => e.table);
    expect(declared).toHaveLength(18);
    for (const table of declared) {
      expect(TENANT_TABLE_MANIFEST.find(e => e.table === table)?.scope).toEqual({ scope: 'tenant' });
    }
  });
});
