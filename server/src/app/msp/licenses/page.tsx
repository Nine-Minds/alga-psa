import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { isSelfHostLicensing } from '@alga-psa/licensing';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import LicenseManagementPage from '@/components/licenses/LicenseManagementPage';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'msp/licensing');

  return {
    title: t('managementPage.metaTitle', { defaultValue: 'License' }),
  };
}

// Self-host licensing UI only. On hosted/SaaS there is no license_state row, so
// redirect away rather than render the "self-hosted only" stub.
export default async function Page() {
  if (!(await isSelfHostLicensing())) {
    redirect('/msp/dashboard');
  }
  return <LicenseManagementPage />;
}
