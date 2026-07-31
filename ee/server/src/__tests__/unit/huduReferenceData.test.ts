/**
 * T063 (cache mechanics: TTL expiry, tenant/company/resource keying, capped
 * eviction), T064 (deep-link builders: per-record url + /companies/jump
 * fallback) and F064 (allowlist value stripping) — pure unit tests against
 * referenceData.ts. The action-level cache behavior (second call within TTL,
 * refresh bypass) is covered in huduDataActions.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HUDU_REFERENCE_CACHE_MAX_ENTRIES,
  HUDU_REFERENCE_CACHE_TTL_MS,
  buildHuduCompanyUrl,
  buildHuduRecordUrl,
  clearHuduReferenceCache,
  getCachedHuduList,
  getHuduReferenceCacheSize,
  huduInstanceBaseUrl,
  setCachedHuduList,
  toHuduAssetPasswordSummary,
} from '@ee/lib/integrations/hudu/referenceData';
import type { HuduAssetPassword } from '@ee/lib/integrations/hudu/contracts';

beforeEach(() => {
  clearHuduReferenceCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('T063: reference cache (module-level, per tenant/company/resource)', () => {
  it('round-trips items and keeps tenant, company, and resource entries separate', () => {
    setCachedHuduList('tenant-a', '101', 'assets', [{ id: 1 }], '2026-06-09T10:00:00.000Z');
    setCachedHuduList('tenant-a', '101', 'articles', [{ id: 2 }]);
    setCachedHuduList('tenant-a', '202', 'assets', [{ id: 3 }]);
    setCachedHuduList('tenant-b', '101', 'assets', [{ id: 4 }]);

    expect(getCachedHuduList('tenant-a', '101', 'assets')).toEqual({
      items: [{ id: 1 }],
      fetchedAt: '2026-06-09T10:00:00.000Z',
    });
    expect(getCachedHuduList('tenant-a', '101', 'articles')?.items).toEqual([{ id: 2 }]);
    expect(getCachedHuduList('tenant-a', '202', 'assets')?.items).toEqual([{ id: 3 }]);
    expect(getCachedHuduList('tenant-b', '101', 'assets')?.items).toEqual([{ id: 4 }]);
    expect(getCachedHuduList('tenant-a', '101', 'asset_passwords')).toBeNull();
    expect(getHuduReferenceCacheSize()).toBe(4);
  });

  it('expires entries after the TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-09T10:00:00.000Z'));
    setCachedHuduList('tenant-a', '101', 'assets', [{ id: 1 }]);

    vi.setSystemTime(new Date(Date.parse('2026-06-09T10:00:00.000Z') + HUDU_REFERENCE_CACHE_TTL_MS - 1));
    expect(getCachedHuduList('tenant-a', '101', 'assets')).not.toBeNull();

    vi.setSystemTime(new Date(Date.parse('2026-06-09T10:00:00.000Z') + HUDU_REFERENCE_CACHE_TTL_MS + 1));
    expect(getCachedHuduList('tenant-a', '101', 'assets')).toBeNull();
    expect(getHuduReferenceCacheSize()).toBe(0);
  });

  it('caps the entry count by evicting the oldest entry (no unbounded growth)', () => {
    for (let i = 0; i < HUDU_REFERENCE_CACHE_MAX_ENTRIES; i += 1) {
      setCachedHuduList('tenant-a', String(i), 'assets', [{ id: i }]);
    }
    expect(getHuduReferenceCacheSize()).toBe(HUDU_REFERENCE_CACHE_MAX_ENTRIES);

    setCachedHuduList('tenant-a', 'one-more', 'assets', [{ id: 'new' }]);

    expect(getHuduReferenceCacheSize()).toBe(HUDU_REFERENCE_CACHE_MAX_ENTRIES);
    expect(getCachedHuduList('tenant-a', '0', 'assets')).toBeNull(); // oldest evicted
    expect(getCachedHuduList('tenant-a', 'one-more', 'assets')?.items).toEqual([{ id: 'new' }]);
  });

  it('re-setting an existing key at the cap replaces it without evicting others', () => {
    for (let i = 0; i < HUDU_REFERENCE_CACHE_MAX_ENTRIES; i += 1) {
      setCachedHuduList('tenant-a', String(i), 'assets', [{ id: i }]);
    }

    setCachedHuduList('tenant-a', '5', 'assets', [{ id: 'replaced' }]);

    expect(getHuduReferenceCacheSize()).toBe(HUDU_REFERENCE_CACHE_MAX_ENTRIES);
    expect(getCachedHuduList('tenant-a', '0', 'assets')).not.toBeNull();
    expect(getCachedHuduList('tenant-a', '5', 'assets')?.items).toEqual([{ id: 'replaced' }]);
  });
});

describe('F064: toHuduAssetPasswordSummary (allowlist value stripping)', () => {
  it('drops password, otp_secret, and any unknown field; keeps metadata only', () => {
    const record = {
      id: 42,
      company_id: 101,
      name: 'Office WiFi',
      username: 'admin',
      password: 'hunter2',
      otp_secret: 'JBSWY3DPEHPK3PXP',
      totp_code: '123456',
      some_future_secret_field: 'leak-me-not',
      url: '/passwords/42',
      password_folder_name: 'Network',
      description: 'WPA2 key',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z',
    } as unknown as HuduAssetPassword;

    const summary = toHuduAssetPasswordSummary(record);

    expect(Object.keys(summary).sort()).toEqual([
      'company_id',
      'created_at',
      'description',
      'id',
      'name',
      'password_folder_name',
      'updated_at',
      'url',
      'username',
    ]);
    expect(summary).toEqual({
      id: 42,
      company_id: 101,
      name: 'Office WiFi',
      username: 'admin',
      url: '/passwords/42',
      password_folder_name: 'Network',
      description: 'WPA2 key',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z',
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('JBSWY3DPEHPK3PXP');
    expect(serialized).not.toContain('123456');
  });

  it('normalizes missing optional metadata to null', () => {
    const summary = toHuduAssetPasswordSummary({ id: 1, company_id: 2, name: 'n' } as HuduAssetPassword);
    expect(summary).toEqual({
      id: 1,
      company_id: 2,
      name: 'n',
      username: null,
      url: null,
      password_folder_name: null,
      description: null,
      created_at: null,
      updated_at: null,
    });
  });
});

describe('T064: deep-link builders', () => {
  it('huduInstanceBaseUrl strips trailing slashes and /api(/v1)', () => {
    expect(huduInstanceBaseUrl('https://docs.example.com')).toBe('https://docs.example.com');
    expect(huduInstanceBaseUrl('https://docs.example.com/')).toBe('https://docs.example.com');
    expect(huduInstanceBaseUrl('https://docs.example.com/api/v1')).toBe('https://docs.example.com');
    expect(huduInstanceBaseUrl('https://docs.example.com/api')).toBe('https://docs.example.com');
    expect(huduInstanceBaseUrl(null)).toBeNull();
    expect(huduInstanceBaseUrl('')).toBeNull();
  });

  it('buildHuduRecordUrl keeps absolute urls and resolves relative urls against the instance', () => {
    expect(buildHuduRecordUrl({ url: 'https://docs.example.com/a/server-1' }, null)).toBe(
      'https://docs.example.com/a/server-1'
    );
    expect(buildHuduRecordUrl({ url: '/a/server-1' }, 'https://docs.example.com/api/v1')).toBe(
      'https://docs.example.com/a/server-1'
    );
    expect(buildHuduRecordUrl({ url: 'a/server-1' }, 'https://docs.example.com')).toBe(
      'https://docs.example.com/a/server-1'
    );
  });

  it('buildHuduRecordUrl returns null when there is no usable url', () => {
    expect(buildHuduRecordUrl({ url: null }, 'https://docs.example.com')).toBeNull();
    expect(buildHuduRecordUrl({}, 'https://docs.example.com')).toBeNull();
    expect(buildHuduRecordUrl(null, 'https://docs.example.com')).toBeNull();
    expect(buildHuduRecordUrl({ url: '/a/x' }, null)).toBeNull(); // relative without a base
  });

  it('buildHuduCompanyUrl prefers the company url, then the /companies/jump fallback', () => {
    expect(
      buildHuduCompanyUrl({ url: '/companies/101', id_in_integration: 'c-1', integration_slug: 'alga' }, 'https://docs.example.com')
    ).toBe('https://docs.example.com/companies/101');

    expect(
      buildHuduCompanyUrl({ url: null, id_in_integration: 'c 1', integration_slug: 'alga' }, 'https://docs.example.com')
    ).toBe('https://docs.example.com/api/v1/companies/jump?integration_id=c+1&integration_slug=alga&integration_type=company');

    expect(
      buildHuduCompanyUrl({ url: null, id_in_integration: 4711, integration_slug: 'alga' }, 'https://docs.example.com/')
    ).toBe('https://docs.example.com/api/v1/companies/jump?integration_id=4711&integration_slug=alga&integration_type=company');
  });

  it('buildHuduCompanyUrl returns null when neither url nor a complete jump tuple exists', () => {
    expect(buildHuduCompanyUrl({ url: null, id_in_integration: 'c-1' }, 'https://docs.example.com')).toBeNull();
    expect(buildHuduCompanyUrl({ url: null, integration_slug: 'alga' }, 'https://docs.example.com')).toBeNull();
    expect(buildHuduCompanyUrl({ url: null, id_in_integration: 'c-1', integration_slug: 'alga' }, null)).toBeNull();
    expect(buildHuduCompanyUrl(null, 'https://docs.example.com')).toBeNull();
  });
});
