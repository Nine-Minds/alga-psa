import { describe, it, expect, vi, beforeEach } from 'vitest';

const redirectMock = vi.fn();
const getSessionMock = vi.fn();
const cookieGetMock = vi.fn();

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

vi.mock('next/headers.js', () => ({
  cookies: async () => ({
    get: (...args: unknown[]) => cookieGetMock(...args),
  }),
}));

vi.mock('@alga-psa/auth', () => ({
  getSession: getSessionMock,
}));

vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  getServerTranslation: async () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const { default: SignInPage } = await import('server/src/app/auth/signin/page');

async function render(params: Record<string, string>) {
  await SignInPage({ searchParams: Promise.resolve(params) } as never);
}

describe('SignIn dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieGetMock.mockReturnValue(undefined);
    getSessionMock.mockResolvedValue(null);
  });

  it('forwards the SSO failure params to the MSP sign-in page', async () => {
    await render({
      error: 'AccessDenied',
      reason: 'no_matching_user',
      providerEmail: 'nd@computerbutlereurope.onmicrosoft.com',
    });

    expect(redirectMock).toHaveBeenCalledWith(
      '/auth/msp/signin?error=AccessDenied&reason=no_matching_user&providerEmail=nd%40computerbutlereurope.onmicrosoft.com'
    );
  });

  it('shows a link failure on the profile SSO tab instead of bouncing a signed-in user to the dashboard', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'user-1', user_type: 'internal' } });
    cookieGetMock.mockImplementation((name: string) =>
      name === 'sso-link-state' ? { value: 'signed-link-state' } : undefined
    );

    await render({ error: 'Configuration' });

    // The real redirect() throws, so only the first target can ever be reached.
    expect(redirectMock).toHaveBeenNthCalledWith(
      1,
      '/msp/profile?tab=single-sign-on&linkError=Configuration'
    );
  });

  it('keeps sending a signed-in user without a link attempt to the dashboard', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'user-1', user_type: 'internal' } });

    await render({ error: 'Configuration' });

    expect(redirectMock).toHaveBeenCalledWith('/msp/dashboard');
  });
});
