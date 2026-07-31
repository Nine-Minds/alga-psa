import type { Metadata } from 'next';
import BulkAssignTicketsRouteContent from '../../_components/BulkAssignTicketsRouteContent';

export const metadata: Metadata = {
  title: 'Assign Tickets',
};

export default function BulkAssignTicketsModalPage() {
  return <BulkAssignTicketsRouteContent closeMode="back" />;
}
