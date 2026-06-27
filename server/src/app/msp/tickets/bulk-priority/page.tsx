import type { Metadata } from 'next';
import BulkChangePriorityRouteClient from '../_components/BulkChangePriorityRouteClient';

export const metadata: Metadata = {
  title: 'Set Priority',
};

export default function BulkChangePriorityPage() {
  return <BulkChangePriorityRouteClient closeMode="replace" />;
}
