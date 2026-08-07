import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { redirect } from 'next/navigation';
import { isSelfHostLicensing } from '@alga-psa/licensing';
import { NINEMINDS_PORTAL_URL } from '@/lib/ninemindsPortal';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.account.layout.title', { defaultValue: 'Account' }),
  };
}

// Account management is the hosted/SaaS Stripe subscription page (plan, add-ons,
// payment, invoices, buy/upgrade licenses). Self-host/on-prem installs purchase
// licensing through the Nine Minds client portal, not in-app Stripe — so send
// any direct access here to the portal on-prem (the in-menu "Account" entry
// opens it in a new tab).
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
