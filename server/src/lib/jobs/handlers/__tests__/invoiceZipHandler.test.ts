import { describe, expect, it } from 'vitest';
import { selectBundleClientId } from '../invoiceZipHandler';

describe('selectBundleClientId', () => {
  it('files a single-client bundle under that client', () => {
    expect(selectBundleClientId(['client-a', 'client-a', 'client-a'])).toBe('client-a');
  });

  it('files a mixed bundle with no client rather than inventing one', () => {
    expect(selectBundleClientId(['client-a', 'client-b'])).toBeNull();
  });

  it('returns null when no invoice carries a client, instead of failing the job', () => {
    // The fresh-trial-tenant case: previously this looked up tenant_companies.is_default
    // and threw 'No default client found for tenant', discarding an already-stored ZIP.
    expect(selectBundleClientId([null, undefined])).toBeNull();
    expect(selectBundleClientId([])).toBeNull();
  });

  it('ignores empty and missing client ids when deciding whether the bundle is single-client', () => {
    expect(selectBundleClientId(['client-a', null, '', undefined])).toBe('client-a');
  });
});
