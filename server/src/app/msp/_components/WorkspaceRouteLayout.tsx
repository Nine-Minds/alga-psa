import WorkspaceProviders from '@/components/layout/WorkspaceProviders';
import { registerSlaIntegration } from '@alga-psa/msp-composition/tickets/registerSlaIntegration';

interface WorkspaceRouteLayoutProps {
  children: React.ReactNode;
}

export default function WorkspaceRouteLayout({ children }: Readonly<WorkspaceRouteLayoutProps>) {
  registerSlaIntegration();

  return <WorkspaceProviders>{children}</WorkspaceProviders>;
}
