import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { requireCapabilityForPage } from '@alga-psa/core/capability/server';
import { TicketsRouteProvider } from '@alga-psa/tickets/components/TicketsRouteProvider';
import WorkspaceRouteLayout from '../../../../../_components/WorkspaceRouteLayout';

// The native ticket screen needs the same workspace providers (documents cross-feature, SLA
// integration, tickets routing) that /msp/tickets mounts in its own layout.
export const dynamic = 'force-dynamic';

export default async function CoManagedSharedTicketLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const tenant = session?.user?.tenant;
  if (!tenant) notFound();
  await requireCapabilityForPage('co-managed', tenant, 'serves');
  return (
    <WorkspaceRouteLayout>
      <TicketsRouteProvider>{children}</TicketsRouteProvider>
    </WorkspaceRouteLayout>
  );
}
