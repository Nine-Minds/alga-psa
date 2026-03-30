import { describe, expect, it } from 'vitest';

import { getServiceRequestEnterpriseProviderRegistrations } from '../../../../../ee/server/src/lib/service-requests/providers';

describe('enterprise service request provider registrations', () => {
  it('T005: EE entrypoint returns workflow and advanced provider registrations', async () => {
    const registrations = await getServiceRequestEnterpriseProviderRegistrations();

    expect(registrations.executionProviders.map((provider) => provider.key).sort()).toEqual([
      'ticket-plus-workflow',
      'workflow-only',
    ]);

    expect(registrations.formBehaviorProviders.map((provider) => provider.key)).toEqual(['advanced']);
    expect(registrations.visibilityProviders.map((provider) => provider.key)).toEqual(['advanced-visibility']);
    expect(registrations.templateProviders.map((provider) => provider.key)).toEqual(['ee-starter-pack']);
  });
});
