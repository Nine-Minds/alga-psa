import type { Metadata } from 'next';
import BulkSetDueDateRouteClient from '../../_components/BulkSetDueDateRouteClient';

export const metadata: Metadata = {
  title: 'Set Due Date',
};

export default function BulkSetDueDateModalPage() {
  return <BulkSetDueDateRouteClient closeMode="back" />;
}
