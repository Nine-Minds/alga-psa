import type { Metadata } from 'next';
import { parseCreateTicketPrefill } from '@alga-psa/tickets/lib/createTicketRoute';
import CreateTicketRouteClient from '../_components/CreateTicketRouteClient';

// Full (non-intercepted) create-ticket route: rendered on a hard load/refresh of
// /msp/create-ticket, or when navigated to from outside the /msp segment.
export const metadata: Metadata = {
  title: 'Create Ticket',
};

export default async function CreateTicketPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const prefill = parseCreateTicketPrefill(await searchParams);
  return <CreateTicketRouteClient closeMode="replace" prefill={prefill} />;
}
