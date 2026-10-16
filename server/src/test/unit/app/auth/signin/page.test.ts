import { describe, it, expect, vi, beforeEach } from 'vitest';

const redirectMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
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

    await render({ error: 'Configuration' });

    // The real redirect() throws, so only the first target can ever be reached.
    expect(redirectMock).toHaveBeenNthCalledWith(
      1,
      '/msp/profile?tab=single-sign-on&linkError=Configuration'
    );
  });

  it('surfaces a rejected link that already burned its link-state cookie', async () => {
    // ensureOAuthAccountLink() consumes the cookie before returning false, and
    // Auth.js then sends AccessDenied here with no callbackUrl: without this the
    // failure ends as a silent dashboard redirect.
    getSessionMock.mockResolvedValue({ user: { id: 'user-1', user_type: 'internal' } });

    await render({
      error: 'AccessDenied',
      callbackUrl: '/msp/profile?tab=single-sign-on&linked=1',
    });

    expect(redirectMock).toHaveBeenNthCalledWith(
      1,
      '/msp/profile?tab=single-sign-on&linkError=AccessDenied'
    );
  });

  it('treats a link callback that arrives with no error as a failed link', async () => {
    // Auth.js redirects to its own signin action when a provider yields no
    // usable profile, forwarding only the stored callbackUrl. Honouring that
    // URL would claim `linked=1` succeeded.
    getSessionMock.mockResolvedValue({ user: { id: 'user-1', user_type: 'internal' } });

    await render({ callbackUrl: '/msp/profile?tab=single-sign-on&linked=1' });

    expect(redirectMock).toHaveBeenNthCalledWith(
      1,
      '/msp/profile?tab=single-sign-on&linkError=link_failed'
    );
  });

  it('keeps sending a signed-in user with no failure to the dashboard', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'user-1', user_type: 'internal' } });

    await render({});

    expect(redirectMock).toHaveBeenCalledWith('/msp/dashboard');
  });

  it('leaves a signed-in client portal user on their callback url', async () => {
    // The SSO link tab is MSP-only, so a portal session must not be sent there.
    getSessionMock.mockResolvedValue({ user: { id: 'user-2', user_type: 'client' } });

    await render({ error: 'AccessDenied', callbackUrl: '/client-portal/dashboard' });

    expect(redirectMock).toHaveBeenNthCalledWith(1, '/client-portal/dashboard');
  });
});
