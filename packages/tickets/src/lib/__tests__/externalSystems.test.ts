import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_EXTERNAL_SYSTEMS,
  CUSTOM_EXTERNAL_SYSTEM_KEY_PATTERN,
  type ITenantExternalSystem,
} from '@alga-psa/types';
import {
  customExternalSystemToDefinition,
  findBuiltInExternalSystem,
  isBuiltInExternalSystemKey,
  isCustomExternalSystemKey,
  listExternalSystems,
  renderExternalLinkUrl,
  resolveExternalSystem,
  resolveExternalSystemOrigin,
  safeExternalUrl,
} from '../externalSystems';

describe('externalSystems', () => {
  it('T100: every built-in key is lowercase [a-z0-9_]+ and unique', () => {
    const keys = BUILT_IN_EXTERNAL_SYSTEMS.map((system) => system.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(/^[a-z0-9_]+$/);
      expect(isBuiltInExternalSystemKey(key)).toBe(true);
    }
  });

  it('T101: built-in catalog contains the planned systems', () => {
    const keys = BUILT_IN_EXTERNAL_SYSTEMS.map((system) => system.key);
    expect(keys).toEqual(
      expect.arrayContaining(['discord', 'slack', 'github', 'jira', 'email', 'client_portal', 'api', 'generic']),
    );
  });

  it('T102: custom keys must be namespaced custom:<slug> and never collide with built-ins', () => {
    expect(isCustomExternalSystemKey('custom:vendor')).toBe(true);
    expect(CUSTOM_EXTERNAL_SYSTEM_KEY_PATTERN.test('custom:Vendor')).toBe(false);
    expect(isCustomExternalSystemKey('github')).toBe(false);
    expect(isCustomExternalSystemKey('custom:')).toBe(false);
    expect(customExternalSystemToDefinition({ key: 'github', label: 'GitHub', url_template: null })).toBeNull();
    expect(customExternalSystemToDefinition({ key: 'custom:vendor', label: 'Vendor', url_template: null })).toMatchObject({
      key: 'custom:vendor',
      label: 'Vendor',
      originCategory: 'other',
    });
  });

  it('T103: renderExternalLinkUrl prefers an explicit url over the template', () => {
    const github = findBuiltInExternalSystem('github');
    expect(
      renderExternalLinkUrl(github, {
        external_id: '42',
        realm: 'Nine-Minds/alga-psa',
        url: 'https://example.com/override',
      }),
    ).toBe('https://example.com/override');

    expect(
      renderExternalLinkUrl(github, { external_id: '42', realm: 'Nine-Minds/alga-psa', url: null }),
    ).toBe('https://github.com/Nine-Minds/alga-psa/issues/42');
  });

  it('T104: a realm-bearing template yields no URL without a realm', () => {
    const github = findBuiltInExternalSystem('github');
    expect(renderExternalLinkUrl(github, { external_id: '42', realm: null, url: null })).toBeNull();
  });

  it('T105: systems without a template require an explicit url', () => {
    const generic = findBuiltInExternalSystem('generic');
    expect(renderExternalLinkUrl(generic, { external_id: 'abc', realm: null, url: null })).toBeNull();
    expect(renderExternalLinkUrl(generic, { external_id: 'abc', realm: null, url: 'https://x.example/abc' })).toBe(
      'https://x.example/abc',
    );
  });

  it('T106: resolveExternalSystem resolves built-ins and tenant customs, null otherwise', () => {
    const tenantSystems: ITenantExternalSystem[] = [
      { key: 'custom:vendor', label: 'Vendor', url_template: 'https://vendor.example/{external_id}' },
    ];
    expect(resolveExternalSystem(tenantSystems, 'github')).toMatchObject({ key: 'github' });
    expect(resolveExternalSystem(tenantSystems, 'custom:vendor')).toMatchObject({ key: 'custom:vendor' });
    expect(resolveExternalSystem(tenantSystems, 'custom:missing')).toBeNull();
    expect(listExternalSystems(tenantSystems)).toHaveLength(BUILT_IN_EXTERNAL_SYSTEMS.length + 1);
  });

  it('T107: only http(s) urls are considered safe', () => {
    expect(safeExternalUrl('https://example.com')).toBe('https://example.com/');
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('data:text/html;base64,AAAA')).toBeNull();
    expect(safeExternalUrl('not a url')).toBeNull();
  });

  it('T108: resolveExternalSystemOrigin maps through originCategory and custom to other', () => {
    const tenantSystems: ITenantExternalSystem[] = [
      { key: 'custom:vendor', label: 'Vendor', url_template: null },
    ];
    expect(resolveExternalSystemOrigin(tenantSystems, 'email')).toBe('inbound_email');
    expect(resolveExternalSystemOrigin(tenantSystems, 'api')).toBe('api');
    expect(resolveExternalSystemOrigin(tenantSystems, 'custom:vendor')).toBe('other');
    expect(resolveExternalSystemOrigin(tenantSystems, null)).toBeNull();
  });
});
