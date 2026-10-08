import { redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { SSO_PROFILE_TAB_URL } from '@alga-psa/auth/lib/sso/linkStateCookie';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('auth.signin.title', { defaultValue: 'Sign In' }),
  };
}

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const callbackUrl = typeof params?.callbackUrl === 'string' ? params.callbackUrl : '';
  const readParam = (key: 'error' | 'reason' | 'providerEmail'): string => {
    const value = params?.[key];
    return typeof value === 'string' ? value : '';
  };
  const error = readParam('error');
  const reason = readParam('reason');
  const providerEmail = readParam('providerEmail');

  const session = await getSession();
  if (session?.user) {
    // Auth.js routes every error of kind "error" -- AccessDenied from a rejected
    // `signIn` callback included -- to pages.error, which is this page, and it
    // carries no callbackUrl. The only flow that starts OAuth for a visitor who
    // is already signed in is the profile SSO link, so land the failure on that
    // tab: bouncing to the dashboard would drop it silently (the whole
    // complaint), and honouring a stale `linked=1` callbackUrl would even claim
    // the link succeeded. The link-state cookie is no proof either way --
    // ensureOAuthAccountLink() consumes it before it rejects -- so only the
    // session's own user type decides, since the link tab is MSP-only.
    const isInternalUser = session.user.user_type !== 'client';
    if (error && isInternalUser) {
      const linkParams = new URLSearchParams({ linkError: reason || error });
      if (providerEmail) {
        linkParams.set('providerEmail', providerEmail);
      }
      redirect(`${SSO_PROFILE_TAB_URL}&${linkParams.toString()}`);
    }
    redirect(callbackUrl || '/msp/dashboard');
  }

  const query = new URLSearchParams();
  if (callbackUrl) query.set('callbackUrl', callbackUrl);
  // Auth.js sends its own failures here (pages.error) and SSO mapping failures
  // add a reason; without forwarding them the sign-in page has nothing to show.
  if (error) query.set('error', error);
  if (reason) query.set('reason', reason);
  if (providerEmail) query.set('providerEmail', providerEmail);

  if (callbackUrl.includes('/client-portal')) {
    redirect(`/auth/client-portal/signin${query.toString() ? `?${query.toString()}` : ''}`);
  } else {
    redirect(`/auth/msp/signin${query.toString() ? `?${query.toString()}` : ''}`);
  }
}
