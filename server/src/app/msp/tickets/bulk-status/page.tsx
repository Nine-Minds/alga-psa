import type { Metadata } from 'next';
import BulkChangeStatusRouteClient from '../_components/BulkChangeStatusRouteClient';

export const metadata: Metadata = {
  title: 'Set Status',
};

export default function BulkChangeStatusPage() {
  return <BulkChangeStatusRouteClient closeMode="replace" />;
}
