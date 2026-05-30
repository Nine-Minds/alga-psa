import type { Metadata } from 'next';
import LicenseManagementPage from '@/components/licenses/LicenseManagementPage';

export const metadata: Metadata = {
  title: 'License',
};

export default function Page() {
  return <LicenseManagementPage />;
}
