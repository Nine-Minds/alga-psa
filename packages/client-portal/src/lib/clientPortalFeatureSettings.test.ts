import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CLIENT_PORTAL_FEATURE_SETTINGS,
  normalizeTenantSettings,
  resolveClientPortalFeatureSettings,
} from './clientPortalFeatureSettings';

describe('client portal feature settings', () => {
  it('keeps appointments enabled when the setting has not been configured', () => {
    expect(resolveClientPortalFeatureSettings(undefined)).toEqual(
      DEFAULT_CLIENT_PORTAL_FEATURE_SETTINGS,
    );
    expect(resolveClientPortalFeatureSettings({ clientPortal: {} })).toEqual(
      DEFAULT_CLIENT_PORTAL_FEATURE_SETTINGS,
    );
  });

  it('disables appointments only when explicitly configured as false', () => {
    expect(resolveClientPortalFeatureSettings({
      clientPortal: { appointmentsEnabled: false },
    })).toEqual({ appointmentsEnabled: false, invitationValidityDays: 7 });
    expect(resolveClientPortalFeatureSettings({
      clientPortal: { appointmentsEnabled: true },
    })).toEqual({ appointmentsEnabled: true, invitationValidityDays: 7 });
  });

  it('reports the tenant\'s invitation validity, clamped to the allowed range', () => {
    expect(resolveClientPortalFeatureSettings({
      clientPortal: { invitationValidityDays: 14 },
    }).invitationValidityDays).toBe(14);
    expect(resolveClientPortalFeatureSettings({
      clientPortal: { invitationValidityDays: 90 },
    }).invitationValidityDays).toBe(30);
    expect(resolveClientPortalFeatureSettings({
      clientPortal: { invitationValidityDays: 'nonsense' },
    }).invitationValidityDays).toBe(7);
  });

  it('normalizes JSON strings and ignores malformed settings', () => {
    expect(resolveClientPortalFeatureSettings(
      JSON.stringify({ clientPortal: { appointmentsEnabled: false, invitationValidityDays: 3 } }),
    )).toEqual({ appointmentsEnabled: false, invitationValidityDays: 3 });
    expect(normalizeTenantSettings('{not-json')).toEqual({});
  });
});
