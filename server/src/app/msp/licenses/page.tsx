import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { isSelfHostLicensing } from '@alga-psa/licensing';
import LicenseManagementPage from '@/components/licenses/LicenseManagementPage';

export const metadata: Metadata = {
  title: 'License',
};

// Self-host licensing UI only. On hosted/SaaS there is no license_state row, so
// redirect away rather than render the "self-hosted only" stub.
export default async function Page() {
  if (!(await isSelfHostLicensing())) {
    redirect('/msp/dashboard');
  }
  return <LicenseManagementPage />;
}
