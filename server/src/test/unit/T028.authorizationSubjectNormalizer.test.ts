import { describe, expect, it, vi } from 'vitest';

vi.mock('server/src/lib/authorization/kernel', () => ({ getAuthorizationKernel: vi.fn() }));

import { buildAuthorizationPrincipalSubject } from '../../lib/api/controllers/authorizationKernel';

// T028 (F015): the authorization-subject normalizer maps 'service' explicitly.
describe('T028 authorization subject normalizer', () => {
  const subjectFor = (user_type: string | undefined) =>
    buildAuthorizationPrincipalSubject({ tenant: 't', user_id: 'u', user_type });

  it('maps service to service, never internal or client', () => {
    expect(subjectFor('service').userType).toBe('service');
  });
  it('keeps internal and client unchanged', () => {
    expect(subjectFor('internal').userType).toBe('internal');
    expect(subjectFor('client').userType).toBe('client');
  });
});
