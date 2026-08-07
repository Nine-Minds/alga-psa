import { cookies } from 'next/headers.js';
import { redirect } from 'next/navigation';
import { MspSignIn, PortalSwitchPrompt } from '@alga-psa/auth/client';
import { getSession } from '@alga-psa/auth';
import {
  MSP_REMEMBERED_EMAIL_COOKIE,
  normalizeRememberedEmail,
} from '@alga-psa/auth/lib/mspRememberedEmail';
import { UserSession } from '@alga-psa/db/models/UserSession';
import { I18nWrapper } from '@alga-psa/tenancy/components';
import type { Metadata } from 'next';
import { getServerLocale, getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('auth.msp.signin.title', { defaultValue: 'MSP Sign In' }),
  };
}

export default async function MspSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const callbackUrl = typeof params?.callbackUrl === 'string' ? params.callbackUrl : '/msp/dashboard';
  const cookieStore = await cookies();
  const rememberedEmail = normalizeRememberedEmail(
    cookieStore.get(MSP_REMEMBERED_EMAIL_COOKIE)?.value ?? ''
  );
  const initialEmail = rememberedEmail || undefined;
  // Pre-login there is no user or tenant to resolve against, so this settles on
  // the locale cookie / Accept-Language. Passing it explicitly keeps I18nWrapper
  // from rendering its bootstrap spinner and round-tripping a server action.
  const locale = await getServerLocale();

  const session = await getSession();
  if (session?.user) {
    // Verify session hasn't been revoked before redirecting
    const sessionId = (session as any).session_id;
    if (sessionId && session.user.tenant) {
      const isRevoked = await UserSession.isRevoked(session.user.tenant, sessionId);
      if (isRevoked) {
        // Session was revoked, don't redirect - show signin form
        return (
          <I18nWrapper portal="msp" initialLocale={locale}>
            <MspSignIn initialEmail={initialEmail} />
          </I18nWrapper>
        );
      }
    }

    if (session.user.user_type === 'client') {
      // Client user trying to access MSP portal - show portal switch prompt
      return (
        <I18nWrapper portal="msp" initialLocale={locale}>
          <PortalSwitchPrompt
            currentPortal="client"
            targetPortal="msp"
            currentPortalUrl="/client-portal/dashboard"
            targetPortalSigninUrl="/auth/msp/signin"
            userEmail={session.user.email}
          />
        </I18nWrapper>
      );
    }

    redirect(callbackUrl);
  }
  return (
    <I18nWrapper portal="msp" initialLocale={locale}>
      <MspSignIn initialEmail={initialEmail} />
    </I18nWrapper>
  );
}
