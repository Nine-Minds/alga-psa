import { describe, expect, it } from 'vitest';

import { STARTER_AUTHORIZATION_BUNDLES } from 'server/src/lib/authorization/bundles/starterBundles';

describe('starter authorization bundles', () => {
  it('ships the expected enterprise MSP starter bundle set', () => {
    const keys = STARTER_AUTHORIZATION_BUNDLES.map((bundle) => bundle.key);

    expect(keys).toContain('assigned-client-technician');
    expect(keys).toContain('project-delivery-team');
    expect(keys).toContain('time-manager');
    expect(keys).toContain('restricted-asset-operator');
    expect(keys).toContain('finance-reviewer');
  });
});
