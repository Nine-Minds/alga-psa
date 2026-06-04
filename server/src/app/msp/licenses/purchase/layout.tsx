import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { isSelfHostLicensing } from '@alga-psa/licensing';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { NINEMINDS_PORTAL_URL } from '@/lib/ninemindsPortal';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'msp/licensing');

  return {
    title: t('purchasePage.title', { defaultValue: 'Purchase Licenses' }),
  };
}

// In-app Stripe checkout is hosted/SaaS-only. Self-host/on-prem installs buy
// licensing through the Nine Minds client portal, so the purchase flow (and its
// /success child) sends them to the portal on-prem.
export default async function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (await isSelfHostLicensing()) {
    redirect(NINEMINDS_PORTAL_URL);
  }
  return children;
}
