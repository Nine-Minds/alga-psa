import type { ReactNode } from 'react';
import { TicketsRouteProvider } from '@alga-psa/tickets/components/TicketsRouteProvider';
import WorkspaceRouteLayout from '../_components/WorkspaceRouteLayout';

interface TicketsLayoutProps {
  children: ReactNode;
  modal: ReactNode;
}

export default function TicketsLayout({ children, modal }: TicketsLayoutProps) {
  return (
    <WorkspaceRouteLayout>
      <TicketsRouteProvider>
        {children}
        {modal}
      </TicketsRouteProvider>
    </WorkspaceRouteLayout>
  );
}
