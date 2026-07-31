import type { Metadata } from 'next';
import BulkChangeStatusRouteClient from '../../_components/BulkChangeStatusRouteClient';

export const metadata: Metadata = {
  title: 'Set Status',
};

export default function BulkChangeStatusModalPage() {
  return <BulkChangeStatusRouteClient closeMode="back" />;
}
