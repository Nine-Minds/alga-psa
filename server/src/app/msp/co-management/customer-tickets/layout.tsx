import type { ReactNode } from 'react';
import WorkspaceRouteLayout from '../../_components/WorkspaceRouteLayout';

/** The shared-ticket screen is the standard ticket screen, so it needs the same workspace providers every native /msp ticket route has. */
export default function CoManagedCustomerTicketsLayout({ children }: { children: ReactNode }) {
  return <WorkspaceRouteLayout>{children}</WorkspaceRouteLayout>;
}
