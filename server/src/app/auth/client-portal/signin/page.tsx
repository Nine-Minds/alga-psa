import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import ClientPortalSignIn from 'server/src/components/auth/ClientPortalSignIn';
import { getTenantBrandingByDomain } from 'server/src/lib/actions/tenant-actions/getTenantBrandingByDomain';
import { getSession } from 'server/src/lib/auth/getSession';

export default async function ClientSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const callbackUrl = typeof params?.callbackUrl === 'string' ? params.callbackUrl : '/client-portal/dashboard';
  const session = await getSession();
  if (session?.user) {
    if (session.user.user_type === 'internal') {
      const canonicalBase = process.env.NEXTAUTH_URL;

      if (!canonicalBase) {
        throw new Error('NEXTAUTH_URL must be set to redirect MSP users from client portal sign-in');
      }

      let mspRedirect: string;

      try {
        mspRedirect = new URL('/msp/dashboard', canonicalBase).toString();
      } catch (error) {
        throw new Error('NEXTAUTH_URL is invalid and cannot be used for MSP redirect');
      }

      return redirect(mspRedirect);
    }

    return redirect(callbackUrl);
  }

  // Get the current domain from headers (styles are injected in root layout)
  const headersList = await headers();
  const host = headersList.get('host') || '';

  // Fetch tenant branding based on domain
  const branding = await getTenantBrandingByDomain(host);

  return <ClientPortalSignIn branding={branding} />;
}
