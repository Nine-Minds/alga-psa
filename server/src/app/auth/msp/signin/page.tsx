import { cookies } from 'next/headers.js';
import { redirect } from 'next/navigation';
import { MspSignIn, PortalSwitchPrompt } from '@alga-psa/auth/client';
import { getSession } from '@alga-psa/auth';
import {
  MSP_REMEMBERED_EMAIL_COOKIE,
  normalizeRememberedEmail,
} from '@alga-psa/auth/lib/mspRememberedEmail';
import { UserSession } from '@alga-psa/db/models/UserSession';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'MSP Sign In',
};

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

  const session = await getSession();
  if (session?.user) {
    // Verify session hasn't been revoked before redirecting
    const sessionId = (session as any).session_id;
    if (sessionId && session.user.tenant) {
      const isRevoked = await UserSession.isRevoked(session.user.tenant, sessionId);
      if (isRevoked) {
        // Session was revoked, don't redirect - show signin form
        return <MspSignIn initialEmail={initialEmail} />;
      }
    }

    if (session.user.user_type === 'client') {
      // Client user trying to access MSP portal - show portal switch prompt
      return (
        <PortalSwitchPrompt
          currentPortal="client"
          targetPortal="msp"
          currentPortalUrl="/client-portal/dashboard"
          targetPortalSigninUrl="/auth/msp/signin"
          userEmail={session.user.email}
        />
      );
    }

    redirect(callbackUrl);
  }
  return <MspSignIn initialEmail={initialEmail} />;
}
