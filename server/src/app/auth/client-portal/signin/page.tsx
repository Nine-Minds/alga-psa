import { redirect } from 'next/navigation';
import ClientPortalSignIn from 'server/src/components/auth/ClientPortalSignIn';
import { I18nWrapper } from 'server/src/components/i18n/I18nWrapper';
import { getTenantBrandingByDomain, getTenantLocaleByDomain } from 'server/src/lib/actions/tenant-actions/getTenantBrandingByDomain';
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

  // Get portalDomain from query parameter (set by middleware for vanity domains)
  const portalDomain = typeof params?.portalDomain === 'string' ? params.portalDomain : null;

  // Fetch tenant branding and locale based on portalDomain (if present)
  const [branding, locale] = portalDomain
    ? await Promise.all([
        getTenantBrandingByDomain(portalDomain),
        getTenantLocaleByDomain(portalDomain),
      ])
    : [null, null];

  return (
    <I18nWrapper portal="client" initialLocale={locale || undefined}>
      <ClientPortalSignIn branding={branding} />
    </I18nWrapper>
  );
}
