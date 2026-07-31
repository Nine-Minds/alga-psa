import { describe, expect, it } from 'vitest';

import { buildEntraCallbackErrorKey } from '@ee/components/settings/integrations/entra/entraCallbackErrors';

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
