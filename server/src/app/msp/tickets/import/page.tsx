import type { Metadata } from 'next';
import TicketImportRouteContent from '../_components/TicketImportRouteContent';

export const metadata: Metadata = {
  title: 'Import Tickets',
};

export default function TicketImportPage() {
  return <TicketImportRouteContent closeMode="replace" />;
}
