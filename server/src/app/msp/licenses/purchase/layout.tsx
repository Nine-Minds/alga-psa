import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { isEnterprise } from '@alga-psa/core/features';
import { isSelfHostLicensing } from '@alga-psa/licensing';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { NINEMINDS_PORTAL_URL } from '@/lib/ninemindsPortal';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'msp/licensing');

  return {
    title: t('purchasePage.title', { defaultValue: 'Purchase Licenses' }),
  };
}

// In-app Stripe checkout is hosted/SaaS-only. Licensed self-host Enterprise
// installs keep using the Nine Minds portal. Community Edition must reach the
// page body so its edition prompt is visible rather than redirecting away.
export default async function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (isEnterprise && await isSelfHostLicensing()) {
    redirect(NINEMINDS_PORTAL_URL);
  }
  return children;
}
