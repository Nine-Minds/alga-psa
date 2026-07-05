import type { Metadata } from 'next';
import BulkAssignTicketsRouteContent from '../_components/BulkAssignTicketsRouteContent';

export const metadata: Metadata = {
  title: 'Assign Tickets',
};

export default function BulkAssignTicketsPage() {
  return <BulkAssignTicketsRouteContent closeMode="replace" />;
}
