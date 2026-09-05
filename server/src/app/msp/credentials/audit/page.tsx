import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { CredentialAuditScreen } from '@enterprise/components/credentials/CredentialAuditScreen';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'msp/credentials');
  return {
    title: t('credentials.audit.pageTitle', { defaultValue: 'Password audit log' }),
  };
}

/**
 * Vault-wide audit log screen (`/msp/credentials/audit`).
 *
 * Session-gated exactly like `credentials/page.tsx`. The EE implementation
 * re-checks `getCredentialsContext` (tier) and renders the
 * `credential:audit` forbidden state when the viewer may see the
 * vault but not its audit trail. CE builds resolve the `@enterprise` import
 * to the render-null stub.
 */
export default async function CredentialAuditPage() {
  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  return <CredentialAuditScreen />;
}

export const dynamic = 'force-dynamic';
