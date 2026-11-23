import { describe, expect, it } from 'vitest';
import { resolveMicrosoftOAuthAuthority } from '../microsoftAuthority';

const GUID = '11111111-2222-3333-4444-555555555555';

describe('resolveMicrosoftOAuthAuthority', () => {
  it('platform-managed -> common', () => {
    expect(resolveMicrosoftOAuthAuthority({ issuerKind: 'platform-managed' })).toBe('common');
  });

  it('platform-managed whose profile row has a tenant_id GUID -> still common (AADSTS50020 regression guard)', () => {
    expect(resolveMicrosoftOAuthAuthority({ issuerKind: 'platform-managed', profileTenantId: GUID })).toBe('common');
  });

  it('tenant-owned GUID -> GUID', () => {
    expect(resolveMicrosoftOAuthAuthority({ issuerKind: 'tenant-owned', profileTenantId: GUID })).toBe(GUID);
  });

  it('tenant-owned domain -> domain', () => {
    expect(resolveMicrosoftOAuthAuthority({ issuerKind: 'tenant-owned', profileTenantId: 'contoso.onmicrosoft.com' })).toBe(
      'contoso.onmicrosoft.com'
    );
  });

  it('tenant-owned value is trimmed', () => {
    expect(resolveMicrosoftOAuthAuthority({ issuerKind: 'tenant-owned', profileTenantId: `  ${GUID} ` })).toBe(GUID);
  });

  it.each([undefined, null, '', '   '])('tenant-owned empty (%j) -> common', (value) => {
    expect(resolveMicrosoftOAuthAuthority({ issuerKind: 'tenant-owned', profileTenantId: value as any })).toBe('common');
  });

  it.each(['common', 'COMMON', 'organizations', 'Organizations'])('tenant-owned %s -> common', (value) => {
    expect(resolveMicrosoftOAuthAuthority({ issuerKind: 'tenant-owned', profileTenantId: value })).toBe('common');
  });
});
