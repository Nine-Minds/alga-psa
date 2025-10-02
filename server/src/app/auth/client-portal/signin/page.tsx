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

  // Get the current domain from headers (styles are injected in root layout)
  const headersList = await headers();
  const host = headersList.get('host') || '';

  // Redirect vanity/custom domains to the canonical NEXTAUTH_URL login to ensure auth cookies work
  const canonicalBase = process.env.NEXTAUTH_URL;
  if (canonicalBase) {
    try {
      const canonicalLogin = new URL('/auth/client-portal/signin', canonicalBase);
      if (host && canonicalLogin.hostname !== host) {
        const forwardedProto = headersList.get('x-forwarded-proto')?.split(',')[0]?.trim();
        const forwardedHost = headersList.get('x-forwarded-host')?.split(',')[0]?.trim();
        const protocol = forwardedProto || (host.includes('localhost') ? 'http' : canonicalLogin.protocol.replace(/:$/, '')) || 'https';
        const effectiveHost = forwardedHost || host;
        const pathname = headersList.get('x-pathname') || '/auth/client-portal/signin';

        const currentUrl = new URL(`${protocol}://${effectiveHost}`);
        currentUrl.pathname = pathname;

        const search = new URLSearchParams();
        for (const [key, value] of Object.entries(params || {})) {
          if (typeof value === 'string') {
            search.append(key, value);
          } else if (Array.isArray(value)) {
            value.forEach((v) => {
              if (typeof v === 'string') {
                search.append(key, v);
              }
            });
          }
        }

        const existingCallback = typeof params?.callbackUrl === 'string' ? params.callbackUrl : undefined;
        if (existingCallback) {
          if (!/^https?:\/\//i.test(existingCallback)) {
            const absoluteCallback = new URL(existingCallback, currentUrl);
            search.set('callbackUrl', absoluteCallback.toString());
          }
        } else {
          if ([...search.keys()].length) {
            currentUrl.search = search.toString();
          }
          search.set('callbackUrl', currentUrl.toString());
        }

        canonicalLogin.search = search.toString();
        return redirect(canonicalLogin.toString());
      }
    } catch (error) {
      console.error('Failed to construct canonical login URL', error);
    }
  }

  // Fetch tenant branding and locale based on domain
  const [branding, locale] = await Promise.all([
    getTenantBrandingByDomain(host),
    getTenantLocaleByDomain(host),
  ]);

  return (
    <I18nWrapper portal="client" initialLocale={locale || undefined}>
      <ClientPortalSignIn branding={branding} />
    </I18nWrapper>
  );
}
