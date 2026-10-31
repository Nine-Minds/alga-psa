import type { ReactNode } from 'react';
import { TicketsRouteProvider } from '@alga-psa/tickets/components/TicketsRouteProvider';
import WorkspaceRouteLayout from '../../../../../_components/WorkspaceRouteLayout';

// The native ticket screen needs the same workspace providers (documents cross-feature, SLA
// integration, tickets routing) that /msp/tickets mounts in its own layout.
export default function CoManagedSharedTicketLayout({ children }: { children: ReactNode }) {
  return (
    <WorkspaceRouteLayout>
      <TicketsRouteProvider>{children}</TicketsRouteProvider>
    </WorkspaceRouteLayout>
  );
}
