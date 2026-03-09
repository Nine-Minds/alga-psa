import { ClientPortalSettingsPage } from '@alga-psa/client-portal/components';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Company Settings',
  description: 'Manage your company settings and configurations',
};

export default function ClientSettingsPage() {
  return <ClientPortalSettingsPage />;
}
