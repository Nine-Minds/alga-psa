import { describe, expect, it } from 'vitest';
import { resolveXeroRealmAliases, type XeroConnectionsById } from './xeroRealmIdentity';

const connections: XeroConnectionsById = {
  'xero-conn-1': { connectionId: 'xero-conn-1', xeroTenantId: 'org-1' },
  'xero-conn-2': { connectionId: 'xero-conn-2', xeroTenantId: 'org-2' }
};

describe('resolveXeroRealmAliases', () => {
  it('returns the connection id first then its uniquely-owned organisation id', async () => {
    await expect(resolveXeroRealmAliases('tenant-1', 'xero-conn-1', connections)).resolves.toEqual([
      'xero-conn-1',
      'org-1'
    ]);
  });

  it('maps a legacy organisation-id target to its owning connection', async () => {
    await expect(resolveXeroRealmAliases('tenant-1', 'org-2', connections)).resolves.toEqual([
      'xero-conn-2',
      'org-2'
    ]);
  });

  it('fails closed for an unknown target (exact id only)', async () => {
    await expect(resolveXeroRealmAliases('tenant-1', 'org-removed', connections)).resolves.toEqual([
      'org-removed'
    ]);
    await expect(resolveXeroRealmAliases('tenant-1', 'xero-conn-gone', connections)).resolves.toEqual([
      'xero-conn-gone'
    ]);
  });

  it('never aliases an organisation owned by more than one connection', async () => {
    const ambiguous: XeroConnectionsById = {
      'xero-conn-1': { connectionId: 'xero-conn-1', xeroTenantId: 'org-shared' },
      'xero-conn-2': { connectionId: 'xero-conn-2', xeroTenantId: 'org-shared' }
    };

    // A connection key resolves to itself only — no shared-org alias.
    await expect(resolveXeroRealmAliases('tenant-1', 'xero-conn-1', ambiguous)).resolves.toEqual([
      'xero-conn-1'
    ]);
    // An organisation id with two owners aliases nothing.
    await expect(resolveXeroRealmAliases('tenant-1', 'org-shared', ambiguous)).resolves.toEqual([
      'org-shared'
    ]);
  });

  it('returns an empty list when no realm is requested', async () => {
    await expect(resolveXeroRealmAliases('tenant-1', null, connections)).resolves.toEqual([]);
    await expect(resolveXeroRealmAliases('tenant-1', undefined, connections)).resolves.toEqual([]);
  });
});
