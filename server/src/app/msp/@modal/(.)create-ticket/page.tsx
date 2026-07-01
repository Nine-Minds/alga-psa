import type { Metadata } from 'next';
import { parseCreateTicketPrefill } from '@alga-psa/tickets/lib/createTicketRoute';
import CreateTicketRouteClient from '../../_components/CreateTicketRouteClient';

// Intercepted create-ticket route: rendered in the msp @modal slot when navigated to from
// within /msp/* (soft navigation), so the create dialog overlays the current page.
export const metadata: Metadata = {
  title: 'Create Ticket',
};

export default async function CreateTicketModalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const prefill = parseCreateTicketPrefill(await searchParams);
  return <CreateTicketRouteClient closeMode="back" prefill={prefill} />;
}
