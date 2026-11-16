import {
  TENANT_TABLE_MANIFEST as SHARED_TENANT_TABLE_MANIFEST,
  type TenantTableEntry,
} from '@alga-psa/db/tenantTableManifest';

// Enterprise lifecycle consumers compose their additional tables with the shared
// manifest. This leaf table has no restrictive FKs and can be deleted first.
export const TENANT_TABLE_MANIFEST: readonly TenantTableEntry[] = [
  { table: 'service_principals', deletion: 'ordered', scope: { scope: 'tenant' }, citus: 'distributed' },
  ...SHARED_TENANT_TABLE_MANIFEST,
];
