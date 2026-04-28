import type { Metadata } from 'next';
import { ClientDevicesPage } from '@alga-psa/client-portal/components';

export const metadata: Metadata = {
  title: 'My devices',
};

export default function DevicesPage() {
  return <ClientDevicesPage />;
}
