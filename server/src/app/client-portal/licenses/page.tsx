import type { Metadata } from 'next';
import ClientLicensesPage from '@alga-psa/client-portal/components/licenses/ClientLicensesPage';

export const metadata: Metadata = {
  title: 'Licenses',
};

export default function LicensesPage() {
  return <ClientLicensesPage />;
}
