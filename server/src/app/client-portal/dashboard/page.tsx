import { ClientDashboard } from '@alga-psa/client-portal/components';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export default function DashboardPage() {
  return <ClientDashboard />;
}
