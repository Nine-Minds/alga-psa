import type { Metadata } from 'next';
import BulkChangePriorityRouteClient from '../../_components/BulkChangePriorityRouteClient';

export const metadata: Metadata = {
  title: 'Set Priority',
};

export default function BulkChangePriorityModalPage() {
  return <BulkChangePriorityRouteClient closeMode="back" />;
}
