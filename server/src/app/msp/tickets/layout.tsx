import type { ReactNode } from 'react';
import { TicketsRouteProvider } from '@alga-psa/tickets/components/TicketsRouteProvider';

interface TicketsLayoutProps {
  children: ReactNode;
  modal: ReactNode;
}

export default function TicketsLayout({ children, modal }: TicketsLayoutProps) {
  return (
    <TicketsRouteProvider>
      {children}
      {modal}
    </TicketsRouteProvider>
  );
}
