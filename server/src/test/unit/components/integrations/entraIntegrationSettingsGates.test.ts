import { describe, expect, it } from 'vitest';

import {
  buildEntraCallbackErrorKey,
  buildEntraConnectionOptions,
  buildEntraStatusHeaderAction,
  shouldShowAmbiguousQueue,
  shouldShowFieldSyncControls,
} from '@ee/components/settings/integrations/entraIntegrationSettingsGates';

describe('buildEntraConnectionOptions', () => {
  it('returns only the Direct option when CIPP is disabled', () => {
    const options = buildEntraConnectionOptions(false);

    expect(options.map((option) => option.id)).toEqual(['direct']);
    expect(options.find((option) => option.id === 'cipp')).toBeUndefined();
  });

  it('returns Direct and CIPP options when CIPP is enabled', () => {
    const options = buildEntraConnectionOptions(true);

    expect(options.map((option) => option.id)).toEqual(['direct', 'cipp']);
    expect(options.find((option) => option.id === 'cipp')).toBeDefined();
  });

  it('renders field-sync controls and the review queue unconditionally now their flags are retired', () => {
    // Both panels were the most reassuring part of the feature and both were
    // hidden behind default-off flags. Neither flag exists any more.
    expect(shouldShowFieldSyncControls()).toBe(true);
    expect(shouldShowAmbiguousQueue()).toBe(true);
  });
});

describe('buildEntraStatusHeaderAction', () => {
  it('offers no action on a never-connected tenant', () => {
    expect(buildEntraStatusHeaderAction({ status: 'not_connected', connectionType: null })).toEqual({
      disconnect: false,
      reconnect: null,
    });
  });

  it('offers Disconnect while connected', () => {
    expect(buildEntraStatusHeaderAction({ status: 'connected', connectionType: 'cipp' })).toEqual({
      disconnect: true,
      reconnect: null,
    });
  });

  it('reconnects the stored connection type rather than assuming direct', () => {
    expect(buildEntraStatusHeaderAction({ status: 'validation_failed', connectionType: 'cipp' })).toEqual({
      disconnect: false,
      reconnect: 'cipp',
    });
    expect(buildEntraStatusHeaderAction({ status: 'validation_failed', connectionType: 'direct' })).toEqual({
      disconnect: false,
      reconnect: 'direct',
    });
  });
});

describe('buildEntraCallbackErrorKey', () => {
  it('names the remediation when Microsoft withheld admin consent', () => {
    expect(buildEntraCallbackErrorKey('consent_missing')).toBe(
      'integrations.entra.settings.connection.callbackErrors.consentMissing'
    );
  });

  it('groups rejected tokens with failed validation', () => {
    expect(buildEntraCallbackErrorKey('auth_rejected')).toBe(
      'integrations.entra.settings.connection.callbackErrors.validationFailed'
    );
    expect(buildEntraCallbackErrorKey('validation_failed')).toBe(
      'integrations.entra.settings.connection.callbackErrors.validationFailed'
    );
  });

  it('always yields a message, so a failed callback is never silent', () => {
    expect(buildEntraCallbackErrorKey('expired_state')).toBe(
      'integrations.entra.settings.connection.callbackErrors.expired'
    );
    expect(buildEntraCallbackErrorKey('some_provider_code')).toBe(
      'integrations.entra.settings.connection.callbackErrors.generic'
    );
    expect(buildEntraCallbackErrorKey(null)).toBe(
      'integrations.entra.settings.connection.callbackErrors.generic'
    );
  });
});
