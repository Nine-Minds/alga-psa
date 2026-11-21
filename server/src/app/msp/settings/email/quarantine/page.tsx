import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { settingsTabMetadata } from '@/components/settings/settingsTabMetadata';
import { InboundQuarantineQueue } from '@alga-psa/integrations/components/email/admin/InboundQuarantineQueue';

export async function generateMetadata(): Promise<Metadata> {
  return settingsTabMetadata('email');
}

interface QuarantineQueueRouteProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

// Sits under the Email settings tab (/msp/settings/email). Admin-only: the
// queue's server actions require ticket_settings:update.
export default async function InboundQuarantineQueueRoute({ searchParams }: QuarantineQueueRouteProps) {
  const params = searchParams ? await searchParams : {};
  const ticketId = typeof params.ticketId === 'string' ? params.ticketId : undefined;
  return (
    <SettingsTab tabId="email">
      <InboundQuarantineQueue initialTicketId={ticketId} />
    </SettingsTab>
  );
}

export const dynamic = 'force-dynamic';
