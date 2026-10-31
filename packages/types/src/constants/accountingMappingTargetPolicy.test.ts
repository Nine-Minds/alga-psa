import { describe, expect, it } from 'vitest';
import { isSharedMappingTarget } from './accountingMappingTargetPolicy';

type Row = [string, string, Record<string, unknown> | null | undefined, boolean];

const matrix: Row[] = [
  // Xero: only revenue-account targets are shareable; missing kind = item.
  ['xero', 'service', { xeroTargetKind: 'account' }, true],
  ['xero', 'discount', { xeroTargetKind: 'account' }, true],
  ['xero', 'service', { xeroTargetKind: 'item' }, false],
  ['xero', 'service', {}, false],
  ['xero', 'service', null, false],
  ['xero', 'service', undefined, false],
  ['xero', 'client', null, false],
  // QuickBooks Desktop: unchanged.
  ['quickbooks_desktop', 'service', null, true],
  ['quickbooks_desktop', 'discount', null, true],
  ['quickbooks_desktop', 'tax_code', null, true],
  ['quickbooks_desktop', 'client', null, false],
  ['quickbooks_desktop', 'payment_term', null, false],
  // QuickBooks Online: services/products and the automatic discount only.
  ['quickbooks_online', 'service', null, true],
  ['quickbooks_online', 'discount', null, true],
  ['quickbooks_online', 'tax_code', null, false],
  ['quickbooks_online', 'client', null, false],
  ['quickbooks_online', 'invoice', null, false],
  ['quickbooks_online', 'payment', null, false],
  ['quickbooks_online', 'payment_term', null, false],
  ['quickbooks_online', 'service_category', null, false],
  // Xero metadata never leaks into other providers.
  ['quickbooks_online', 'client', { xeroTargetKind: 'account' }, false],
  ['unknown_provider', 'service', null, false],
];

describe('isSharedMappingTarget', () => {
  it.each(matrix)('%s / %s / %j -> shareable=%s', (integration, entity, metadata, expected) => {
    expect(isSharedMappingTarget(integration, entity, metadata)).toBe(expected);
  });
});
