import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { isLicenseDistributionTenant } from '@alga-psa/licensing';
import ClientLicensesPage from '@alga-psa/client-portal/components/licenses/ClientLicensesPage';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('clientPortal.licenses.title', { defaultValue: 'Licenses' }),
  };
}

// Appliance-license purchase/management is exclusive to the Nine Minds
// distribution tenant. Any other tenant's client-portal user who reaches this
// route directly is sent back to their dashboard.
export default async function LicensesPage() {
  const user = await getCurrentUser();
  if (!user || !isLicenseDistributionTenant(user.tenant)) {
    redirect('/client-portal/dashboard');
  }
  return <ClientLicensesPage />;
}
