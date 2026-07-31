import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const actionSource = readFileSync(
  new URL('../src/actions/accountingSyncActions.ts', import.meta.url),
  'utf8',
);
const hookSource = readFileSync(
  new URL('../src/components/invoices/useInvoiceSyncStatuses.ts', import.meta.url),
  'utf8',
);

describe('CE invoice sync-status capability probe', () => {
  it('returns an empty status map instead of throwing on core CE invoice screens', () => {
    const statusAction = actionSource.slice(
      actionSource.indexOf('export const getInvoiceSyncStatuses'),
      actionSource.indexOf('export interface AccountingSyncRealmInfo'),
    );

    expect(statusAction).toContain('if (!isEnterpriseEdition())');
    expect(statusAction).toContain('return {};');
    expect(statusAction.indexOf('return {};')).toBeLessThan(statusAction.indexOf('checkBillingReadAccess'));
    expect(statusAction).not.toContain('assertEnterpriseEdition();');
  });

  it('hides accounting-sync UI when the capability probe returns no statuses', () => {
    expect(hookSource).toContain('invoiceIds.length > 0 && Object.keys(result).length === 0');
    expect(hookSource).toContain('setHidden(true)');
  });

  it('returns no statuses when QuickBooks is not connected', () => {
    const statusAction = actionSource.slice(
      actionSource.indexOf('export const getInvoiceSyncStatuses'),
      actionSource.indexOf('export interface AccountingSyncRealmInfo'),
    );

    expect(statusAction).toContain('const realm = await resolveDefaultRealm(knex, tenant).catch(() => null);');
    expect(statusAction).toContain('if (!realm)');
    expect(statusAction.indexOf('if (!realm)')).toBeLessThan(statusAction.indexOf("table('tenant_external_entity_mappings')"));
  });
});
