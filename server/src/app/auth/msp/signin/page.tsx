import { cookies, headers } from 'next/headers.js';
import { redirect } from 'next/navigation';
import { MspSignIn, PortalSwitchPrompt } from '@alga-psa/auth/client';
import { getSession } from '@alga-psa/auth';
import {
  MSP_REMEMBERED_EMAIL_COOKIE,
  normalizeRememberedEmail,
} from '@alga-psa/auth/lib/mspRememberedEmail';
import { UserSession } from '@alga-psa/db/models/UserSession';
import { getTenantDisplayNameBySlug, getTenantIdBySlug, isValidTenantSlug } from '@alga-psa/db';
import { I18nWrapper } from '@alga-psa/tenancy/components';
import { requestMspSignInLinksAction } from '../../../actions/tenantDiscoveryActions';
import type { Metadata } from 'next';
import { getServerLocale, getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { resolveDeploymentCapabilities } from '@/lib/deployment/deploymentProfile';
import { resolveRequestHost } from '@/lib/deployment/requestHost';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('auth.msp.signin.title', { defaultValue: 'MSP Sign In' }),
  };
}

/**
 * On a tenant's custom domain MSP SSO runs on the canonical host and the session is handed
 * back (alga-2026-0002996). Returns the canonical origin when this request is on any other
 * host, so the SSO buttons know to navigate there; undefined on the canonical host itself.
 */
async function resolveCanonicalSsoOrigin(): Promise<string | undefined> {
  try {
    const canonical = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL) : null;
    if (!canonical) {
      return undefined;
    }
    const { hostname } = resolveRequestHost({ headers: await headers() }, resolveDeploymentCapabilities());
    return hostname && hostname.toLowerCase() !== canonical.hostname.toLowerCase() ? canonical.origin : undefined;
  } catch {
    return undefined;
  }
}

export default async function MspSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const callbackUrl = typeof params?.callbackUrl === 'string' ? params.callbackUrl : '/msp/dashboard';

  // `?tenant=<slug>` scopes the sign-in to one organization. The slug is public,
  // so it is only trusted once it resolves to a real tenant; malformed and
  // unknown slugs behave identically (silent redirect, no name rendered). Whether
  // the email belongs to that tenant is checked at submit time by the credentials
  // provider and by the scoped SSO resolution.
  let scopedTenant: { slug: string; name?: string } | undefined;
  let scopedTenantId: string | undefined;
  if (params?.tenant !== undefined) {
    const slug = typeof params.tenant === 'string' ? params.tenant.trim().toLowerCase() : '';
    const tenantId = slug && isValidTenantSlug(slug) ? await getTenantIdBySlug(slug) : null;
    if (!tenantId) {
      const unscoped = new URLSearchParams();
      if (typeof params.callbackUrl === 'string') {
        unscoped.set('callbackUrl', params.callbackUrl);
      }
      const query = unscoped.toString();
      redirect(query ? `/auth/msp/signin?${query}` : '/auth/msp/signin');
    }
    scopedTenantId = tenantId;
    // Never render the slug as a stand-in for a missing name: it is derived
    // from the tenant id.
    const name = await getTenantDisplayNameBySlug(slug);
    scopedTenant = name ? { slug, name } : { slug };
  }
  const cookieStore = await cookies();
  const rememberedEmail = normalizeRememberedEmail(
    cookieStore.get(MSP_REMEMBERED_EMAIL_COOKIE)?.value ?? ''
  );
  const initialEmail = rememberedEmail || undefined;
  // MSP sign-in lives on the shared app domain, so unlike the client portal
  // there is no vanity host to resolve a tenant from, and no session yet: this
  // resolves to the system default today. Passing it explicitly still keeps
  // I18nWrapper from rendering its bootstrap spinner and round-tripping a
  // server action for the same answer.
  const locale = await getServerLocale();
  const canonicalSsoOrigin = await resolveCanonicalSsoOrigin();

  const session = await getSession();
  if (session?.user) {
    // Verify session hasn't been revoked before redirecting
    const sessionId = (session as any).session_id;
    if (sessionId && session.user.tenant) {
      const isRevoked = await UserSession.isRevoked(session.user.tenant, sessionId);
      if (isRevoked) {
        // Session was revoked, don't redirect - show signin form
        return (
          <I18nWrapper portal="msp" initialLocale={locale} renderChildrenWhileLoading>
            <MspSignIn requestSignInLinks={requestMspSignInLinksAction} initialEmail={initialEmail} scopedTenant={scopedTenant} canonicalSsoOrigin={canonicalSsoOrigin} />
          </I18nWrapper>
        );
      }
    }

    if (session.user.user_type === 'client') {
      // Client user trying to access MSP portal - show portal switch prompt
      return (
        <I18nWrapper portal="msp" initialLocale={locale} renderChildrenWhileLoading>
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

    // A session for a different organization than the one being signed into is
    // not a reason to skip the form: signing in replaces the session.
    if (!scopedTenantId || session.user.tenant === scopedTenantId) {
      redirect(callbackUrl);
    }
  }
  return (
    <I18nWrapper portal="msp" initialLocale={locale} renderChildrenWhileLoading>
      <MspSignIn requestSignInLinks={requestMspSignInLinksAction} initialEmail={initialEmail} scopedTenant={scopedTenant} canonicalSsoOrigin={canonicalSsoOrigin} />
    </I18nWrapper>
  );
}
