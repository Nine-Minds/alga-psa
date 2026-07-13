import { headers } from 'next/headers.js';
import { PortalSessionHandoff } from '@alga-psa/auth/client';
import { I18nWrapper } from '@alga-psa/tenancy/components';
import { getTenantLocaleByDomain } from '@alga-psa/tenancy/actions';
import type { Metadata } from 'next';
import { resolveDeploymentCapabilities } from '@/lib/deployment/deploymentProfile';
import { resolveRequestHost } from '@/lib/deployment/requestHost';

export const metadata: Metadata = {
  title: 'Signing In',
};

function buildFallbackLoginUrl(): string {
  const authUrl = process.env.NEXTAUTH_URL;

  if (!authUrl) {
    return '/auth/client-portal/signin';
  }

  try {
    const url = new URL(authUrl);
    url.pathname = '/auth/client-portal/signin';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch (error) {
    console.warn('Failed to derive fallback login URL from NEXTAUTH_URL', error);
    return '/auth/client-portal/signin';
  }
}

async function resolveLocale() {
  // The handoff always runs on the tenant's vanity host, so derive the locale
  // from that host (mirrors the client-portal signin page). Wrapping in
  // I18nWrapper also gates rendering until i18next is initialized: without that
  // gate useTranslation suspends after commit and remounts PortalSessionHandoff,
  // which double-fires the single-use OTT exchange.
  try {
    const headersList = await headers();
    const caps = resolveDeploymentCapabilities();
    const { hostname } = resolveRequestHost({ headers: headersList }, caps);
    if (!hostname) {
      return null;
    }
    return await getTenantLocaleByDomain(hostname);
  } catch (error) {
    console.warn('Failed to resolve locale for client portal handoff', error);
    return null;
  }
}

export default async function ClientPortalHandoffPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const ottParam = params?.ott;
  const returnParam = params?.return;

  const ott = typeof ottParam === 'string' ? ottParam : null;
  const returnPath = typeof returnParam === 'string' ? returnParam : undefined;

  const locale = await resolveLocale();

  return (
    <I18nWrapper portal="client" initialLocale={locale || undefined}>
      <PortalSessionHandoff
        ott={ott}
        returnPath={returnPath}
        fallbackLoginUrl={buildFallbackLoginUrl()}
      />
    </I18nWrapper>
  );
}
