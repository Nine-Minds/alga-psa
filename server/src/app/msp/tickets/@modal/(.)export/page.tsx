import type { Metadata } from 'next';
import TicketExportDialogRouteClient from '../../_components/TicketExportDialogRouteClient';

export const metadata: Metadata = {
  title: 'Export Tickets',
};

export default function TicketExportModalPage() {
  return <TicketExportDialogRouteClient closeMode="back" />;
}
