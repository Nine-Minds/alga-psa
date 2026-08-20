import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { CredentialsScreen } from '@enterprise/components/credentials/CredentialsScreen';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'msp/credentials');
  return {
    title: t('credentials.pageTitle', { defaultValue: 'Passwords' }),
  };
}

/**
 * Global credentials vault screen (`/msp/credentials`).
 *
 * The edition/tier/release gates are the same three the nav item uses: the
 * route is server-rendered for the sidebar's "Passwords" entry, the EE
 * implementation in `ee/server/src/components/credentials/CredentialsScreen`
 * re-checks `release-v1-5-feature` + `getCredentialsContext` and renders
 * nothing (or the tier message) when unavailable. CE builds resolve the
 * `@enterprise` import to the render-null stub.
 */
export default async function CredentialsPage() {
  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  return <CredentialsScreen />;
}

export const dynamic = 'force-dynamic';
