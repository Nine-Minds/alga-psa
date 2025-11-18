import { redirect } from 'next/navigation';
import MspSignIn from 'server/src/components/auth/MspSignIn';
import PortalSwitchPrompt from 'server/src/components/auth/PortalSwitchPrompt';
import { getSession } from 'server/src/lib/auth/getSession';

export default async function MspSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const callbackUrl = typeof params?.callbackUrl === 'string' ? params.callbackUrl : '/msp/dashboard';
  const session = await getSession();
  if (session?.user) {
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
  return <MspSignIn />;
}
