import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const axiosPostMock = vi.fn();
const resolveMicrosoftCredentialsForTenantMock = vi.fn();
const saveEntraDirectTokenSetMock = vi.fn();
const createTenantKnexMock = vi.fn();
const runWithTenantMock = vi.fn();

vi.mock('axios', () => ({
  default: { post: axiosPostMock },
  post: axiosPostMock,
}));

vi.mock('@/lib/integrations/entra/auth/microsoftCredentialResolver', () => ({
  resolveMicrosoftCredentialsForTenant: resolveMicrosoftCredentialsForTenantMock,
}));

vi.mock('@/lib/integrations/entra/auth/tokenStore', () => ({
  saveEntraDirectTokenSet: saveEntraDirectTokenSetMock,
}));

vi.mock('@/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
  runWithTenant: runWithTenantMock,
}));

describe('Entra OAuth callback validation', () => {
  beforeEach(() => {
    vi.resetModules();
    axiosPostMock.mockReset();
    resolveMicrosoftCredentialsForTenantMock.mockReset();
    saveEntraDirectTokenSetMock.mockReset();
    createTenantKnexMock.mockReset();
    runWithTenantMock.mockReset();
    process.env.NEXTAUTH_URL = 'http://localhost:3000';
  });

  it('T033: rejects missing and invalid code/state callback requests', async () => {
    const { GET } = await import('@ee/app/api/auth/microsoft/entra/callback/route');

    const missingParamsResponse = await GET(
      new NextRequest('http://localhost:3000/api/auth/microsoft/entra/callback')
    );
    const missingLocation = missingParamsResponse.headers.get('location');

    expect(missingParamsResponse.status).toBe(307);
    expect(missingLocation).toContain('entra_status=failure');
    expect(missingLocation).toContain('error=missing_params');

    const invalidStateResponse = await GET(
      new NextRequest(
        'http://localhost:3000/api/auth/microsoft/entra/callback?code=abc123&state=not-base64'
      )
    );
    const invalidLocation = invalidStateResponse.headers.get('location');

    expect(invalidStateResponse.status).toBe(307);
    expect(invalidLocation).toContain('entra_status=failure');
    expect(invalidLocation).toContain('error=invalid_state');

    expect(resolveMicrosoftCredentialsForTenantMock).not.toHaveBeenCalled();
    expect(axiosPostMock).not.toHaveBeenCalled();
    expect(saveEntraDirectTokenSetMock).not.toHaveBeenCalled();
    expect(createTenantKnexMock).not.toHaveBeenCalled();
    expect(runWithTenantMock).not.toHaveBeenCalled();
  });
});
