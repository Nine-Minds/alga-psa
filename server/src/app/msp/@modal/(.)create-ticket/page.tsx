import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { parseCreateTicketPrefill } from '@alga-psa/tickets/lib/createTicketRoute';
import CreateTicketRouteClient from '../../_components/CreateTicketRouteClient';
import WorkspaceRouteLayout from '../../_components/WorkspaceRouteLayout';

// Intercepted create-ticket route: rendered in the msp @modal slot when navigated to from
// within /msp/* (soft navigation), so the create dialog overlays the current page.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.createTicket.title', { defaultValue: 'Create Ticket' }),
  };
}

export default async function CreateTicketModalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const prefill = parseCreateTicketPrefill(await searchParams);
  return (
    <WorkspaceRouteLayout>
      <CreateTicketRouteClient closeMode="back" prefill={prefill} />
    </WorkspaceRouteLayout>
  );
}
