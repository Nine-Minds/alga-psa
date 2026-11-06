import { describe, expect, it } from 'vitest';
import {
  TENANT_TABLE_MANIFEST as SHARED_TENANT_TABLE_MANIFEST,
  computeTenantDeletionOrder,
  tenantDeletionOrder,
} from '@alga-psa/db/tenantTableManifest';
import { TENANT_TABLE_MANIFEST } from '../tenantTableManifest';

describe('Enterprise tenant lifecycle manifest', () => {
  it('deletes service identities before users while preserving the shared order', () => {
    const sharedOrder = tenantDeletionOrder(SHARED_TENANT_TABLE_MANIFEST);
    const enterpriseOrder = tenantDeletionOrder(TENANT_TABLE_MANIFEST);
    expect(sharedOrder).not.toContain('service_principals');
    expect(enterpriseOrder).toEqual(['service_principals', ...sharedOrder]);
    expect(enterpriseOrder.indexOf('service_principals')).toBeLessThan(enterpriseOrder.indexOf('users'));
    expect(computeTenantDeletionOrder(TENANT_TABLE_MANIFEST).violations).toEqual([]);
    expect(TENANT_TABLE_MANIFEST[0].scope).toEqual({ scope: 'tenant' });
  });
});
