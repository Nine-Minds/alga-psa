import { describe, expect, it } from 'vitest';
import {
  coerceClientPortalSettingsTab,
  resolveClientPortalSettingsSurfaces as resolve,
  type ClientPortalSettingsPermissions,
} from './clientPortalSettingsSurfaces';

const none: ClientPortalSettingsPermissions = {
  hasBillingAccess: false,
  hasClientReadAccess: false,
  hasUserManagementAccess: false,
  hasVisibilityGroupAccess: false,
  isHosted: false,
};
const p = (o: Partial<ClientPortalSettingsPermissions>) => ({ ...none, ...o });

describe('resolveClientPortalSettingsSurfaces', () => {
  it('no permissions -> nothing', () => {
    expect(resolve(none)).toEqual({ tabs: [], showPlanCard: false, showInvoicesCard: false, canOpenSettings: false });
    expect(resolve(p({ isHosted: true })).canOpenSettings).toBe(false);
  });

  it('default User (client:read only): Client Details only, no billing cards', () => {
    const s = resolve(p({ hasClientReadAccess: true, isHosted: true }));
    expect(s.tabs).toEqual(['client-details']);
    expect(s.showPlanCard).toBe(false);
    expect(s.showInvoicesCard).toBe(false);
    expect(s.canOpenSettings).toBe(true);
  });

  it('Finance (hosted): Account + Client Details with billing cards', () => {
    const s = resolve(p({ hasClientReadAccess: true, hasBillingAccess: true, isHosted: true }));
    expect(s.tabs).toEqual(['account', 'client-details']);
    expect(s.showPlanCard && s.showInvoicesCard).toBe(true);
  });

  it('Finance on a non-hosted tenant: no Account tab', () => {
    const s = resolve(p({ hasClientReadAccess: true, hasBillingAccess: true, isHosted: false }));
    expect(s.tabs).toEqual(['client-details']);
  });

  it('client-admin contact adds Visibility Groups', () => {
    const s = resolve(p({ hasClientReadAccess: true, hasVisibilityGroupAccess: true }));
    expect(s.tabs).toEqual(['client-details', 'visibility-groups']);
  });

  it('Admin with everything: all four tabs in canonical order', () => {
    const s = resolve({
      hasBillingAccess: true,
      hasClientReadAccess: true,
      hasUserManagementAccess: true,
      hasVisibilityGroupAccess: true,
      isHosted: true,
    });
    expect(s.tabs).toEqual(['account', 'client-details', 'user-management', 'visibility-groups']);
  });

  it('user:read alone opens settings via User Management', () => {
    const s = resolve(p({ hasUserManagementAccess: true }));
    expect(s.tabs).toEqual(['user-management']);
    expect(s.canOpenSettings).toBe(true);
  });
});

describe('coerceClientPortalSettingsTab', () => {
  const user = resolve(p({ hasClientReadAccess: true, isHosted: true }));
  it('?tab=account for a User lands on client-details', () => {
    expect(coerceClientPortalSettingsTab('account', user)).toBe('client-details');
  });
  it('?tab=user-management for a non-admin is coerced', () => {
    expect(coerceClientPortalSettingsTab('user-management', user)).toBe('client-details');
  });
  it('accepts permitted tabs case-insensitively; defaults when absent', () => {
    const admin = resolve({ ...none, hasBillingAccess: true, hasClientReadAccess: true, isHosted: true, hasUserManagementAccess: true });
    expect(coerceClientPortalSettingsTab('User-Management', admin)).toBe('user-management');
    expect(coerceClientPortalSettingsTab(null, admin)).toBe('account');
  });
  it('undefined when nothing is permitted', () => {
    expect(coerceClientPortalSettingsTab('account', resolve(none))).toBeUndefined();
  });
});
