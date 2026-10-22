import { describe, expect, it } from 'vitest';
import {
  isAudienceAllowed,
  isDefinitionVisibleToRequester,
  type ServiceRequestDefinitionAudience,
} from '../../lib/service-requests/definitionAudience';

const A = 'client-a';
const B = 'client-b';
const G1 = 'group-1';
const G2 = 'group-2';

function visible(
  audience: ServiceRequestDefinitionAudience,
  clientId: string,
  contactGroupId: string | null,
  providerAllowed = true,
  contactId: string | null = contactGroupId ? 'contact-1' : null
) {
  return isDefinitionVisibleToRequester(
    { audience, contactGroupId, context: { clientId, contactId } },
    providerAllowed
  );
}

describe('isDefinitionVisibleToRequester', () => {
  it('all mode admits everyone', () => {
    const audience = { mode: 'all' as const, clientIds: [], groupIds: [] };
    expect(visible(audience, A, null)).toBe(true);
    expect(visible(audience, B, G1)).toBe(true);
  });

  it('provider denial wins over any audience', () => {
    expect(visible({ mode: 'all', clientIds: [], groupIds: [] }, A, null, false)).toBe(false);
    expect(visible({ mode: 'scoped', clientIds: [A], groupIds: [] }, A, null, false)).toBe(false);
  });

  it('client scope admits listed clients only', () => {
    const audience = { mode: 'scoped' as const, clientIds: [A], groupIds: [] };
    expect(visible(audience, A, null)).toBe(true);
    expect(visible(audience, B, null)).toBe(false);
  });

  it('group scope admits members of a listed group only', () => {
    const audience = { mode: 'scoped' as const, clientIds: [], groupIds: [G1] };
    expect(visible(audience, A, G1)).toBe(true);
    expect(visible(audience, A, G2)).toBe(false);
    expect(visible(audience, A, null)).toBe(false);
  });

  it('null contact never matches a group', () => {
    const audience = { mode: 'scoped' as const, clientIds: [], groupIds: [G1] };
    expect(visible(audience, A, null, true, null)).toBe(false);
  });

  it('client or group is enough (union)', () => {
    const audience = { mode: 'scoped' as const, clientIds: [A], groupIds: [G1] };
    expect(visible(audience, A, null)).toBe(true);
    expect(visible(audience, B, G1)).toBe(true);
    expect(visible(audience, B, G2)).toBe(false);
  });

  it('scoped with no rows admits nobody', () => {
    const audience = { mode: 'scoped' as const, clientIds: [], groupIds: [] };
    expect(visible(audience, A, G1)).toBe(false);
    expect(isAudienceAllowed({ audience, clientId: A, contactGroupId: null })).toBe(false);
  });
});
