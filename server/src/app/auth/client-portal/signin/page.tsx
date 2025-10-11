import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
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

  // Get the current domain from headers
  const headersList = await headers();
  const host = headersList.get('host') || '';

  // Check if we have a portalDomain query parameter (from custom domain redirect)
  const portalDomain = typeof params?.portalDomain === 'string' ? params.portalDomain : null;

  // Redirect vanity/custom domains to the canonical NEXTAUTH_URL login to ensure auth cookies work
  const canonicalBase = process.env.NEXTAUTH_URL;
  if (canonicalBase && !portalDomain) {
    try {
      const canonicalUrl = new URL(canonicalBase);
      const currentHost = host.split(':')[0]; // Get hostname without port
      const currentPort = host.split(':')[1] || '';
      const canonicalHost = canonicalUrl.hostname;
      const canonicalPort = canonicalUrl.port || '';

      // Only redirect if we're on a different hostname (not just different port)
      // This ensures custom domains redirect to canonical, but canonical doesn't redirect to itself
      if (currentHost && currentHost !== canonicalHost) {
        // Build the callback URL - this is where the user will be redirected after login
        const forwardedProto = headersList.get('x-forwarded-proto')?.split(',')[0]?.trim();
        const protocol = forwardedProto || (host.includes('localhost') ? 'http' : 'https');

        // Build callback URL back to the custom domain
        const callbackUrl = `${protocol}://${host}/client-portal/dashboard`;

        // Redirect to canonical domain for authentication, passing the custom domain for branding
        const canonicalLogin = new URL('/auth/client-portal/signin', canonicalBase);
        canonicalLogin.searchParams.set('callbackUrl', callbackUrl);
        canonicalLogin.searchParams.set('portalDomain', host);

        console.log('[client-portal-signin] Redirecting custom domain to canonical for auth', {
          customDomain: host,
          currentHost,
          canonicalHost,
          callbackUrl
        });

        return redirect(canonicalLogin.toString());
      }
    } catch (error) {
      console.error('Failed to construct canonical login URL', error);
    }
  }

  // Use portalDomain from query string if present, otherwise use current host
  const brandingDomain = portalDomain || host;

  // Fetch tenant branding and locale based on domain
  const [branding, locale] = await Promise.all([
    getTenantBrandingByDomain(brandingDomain),
    getTenantLocaleByDomain(brandingDomain),
  ]);

  return (
    <I18nWrapper portal="client" initialLocale={locale || undefined}>
      <ClientPortalSignIn branding={branding} />
    </I18nWrapper>
  );
}
