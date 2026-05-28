import type { Metadata } from 'next';
import ServiceRequestsManagementPage from './ServiceRequestsManagementPage';

export const metadata: Metadata = {
  title: 'Service Requests',
};

export default function MspServiceRequestsPage() {
  return <ServiceRequestsManagementPage />;
}
