import { describe, expect, it, beforeEach } from 'vitest';
import {
  getServiceRequestExecutionProvider,
  getServiceRequestFormBehaviorProvider,
  getServiceRequestTemplateProvider,
  getServiceRequestVisibilityProvider,
  listServiceRequestExecutionProviders,
  listServiceRequestFormBehaviorProviders,
  listServiceRequestTemplateProviders,
  listServiceRequestVisibilityProviders,
  resetServiceRequestProviderRegistry,
} from '../../../lib/service-requests';
import { loadEnterpriseServiceRequestProviderRegistrations } from '../../../lib/service-requests/providers/enterpriseEntry';

describe('service request provider registry', () => {
  beforeEach(() => {
    resetServiceRequestProviderRegistry();
  });

  it('T004: CE boot exposes only built-in provider keys', () => {
    const executionKeys = listServiceRequestExecutionProviders().map((provider) => provider.key);
    const formBehaviorKeys = listServiceRequestFormBehaviorProviders().map((provider) => provider.key);
    const visibilityKeys = listServiceRequestVisibilityProviders().map((provider) => provider.key);
    const templateKeys = listServiceRequestTemplateProviders().map((provider) => provider.key);

    expect(executionKeys).toEqual(['ticket-only']);
    expect(formBehaviorKeys).toEqual(['basic']);
    expect(visibilityKeys).toEqual(['all-authenticated-client-users']);
    expect(templateKeys).toEqual(['ce-starter-pack']);
  });

  it('T004: provider lookup by key resolves built-ins', () => {
    expect(getServiceRequestExecutionProvider('ticket-only')).toBeDefined();
    expect(getServiceRequestFormBehaviorProvider('basic')).toBeDefined();
    expect(getServiceRequestVisibilityProvider('all-authenticated-client-users')).toBeDefined();
    expect(getServiceRequestTemplateProvider('ce-starter-pack')).toBeDefined();
  });

  it('T004: CE build remains coherent when enterprise provider registrations are absent', async () => {
    const registrations = await loadEnterpriseServiceRequestProviderRegistrations();

    expect(registrations).toBeNull();
    expect(listServiceRequestExecutionProviders().map((provider) => provider.key)).toEqual(['ticket-only']);
  });
});
