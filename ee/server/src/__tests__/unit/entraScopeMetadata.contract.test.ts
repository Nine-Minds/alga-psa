import { describe, expect, it } from 'vitest';

import { ENTRA_DIRECT_DELEGATED_SCOPES } from '@ee/lib/integrations/entra/auth/directScopes';
import { ENTRA_DIRECT_DISPLAY_SCOPES } from '@alga-psa/integrations/actions/integrations/microsoftShared';

describe('Entra scope metadata contract', () => {
  it('the CE-resident display scope list matches the EE delegated scope list', () => {
    // The Microsoft metadata builder is CE-resident and must not import across
    // the CE/EE boundary, so it carries its own copy of the Entra scope list.
    // Drift between the two would show operators the wrong admin-consent
    // requirements, so it fails here instead.
    expect([...ENTRA_DIRECT_DISPLAY_SCOPES]).toEqual([...ENTRA_DIRECT_DELEGATED_SCOPES]);
  });
});
