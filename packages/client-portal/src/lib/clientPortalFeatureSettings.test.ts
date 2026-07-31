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
    })).toEqual({ appointmentsEnabled: false });
    expect(resolveClientPortalFeatureSettings({
      clientPortal: { appointmentsEnabled: true },
    })).toEqual({ appointmentsEnabled: true });
  });

  it('normalizes JSON strings and ignores malformed settings', () => {
    expect(resolveClientPortalFeatureSettings(
      JSON.stringify({ clientPortal: { appointmentsEnabled: false } }),
    )).toEqual({ appointmentsEnabled: false });
    expect(normalizeTenantSettings('{not-json')).toEqual({});
  });
});
