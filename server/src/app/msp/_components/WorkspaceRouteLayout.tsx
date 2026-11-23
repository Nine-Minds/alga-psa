import WorkspaceProviders from '@/components/layout/WorkspaceProviders';

interface WorkspaceRouteLayoutProps {
  children: React.ReactNode;
}

export default function WorkspaceRouteLayout({ children }: Readonly<WorkspaceRouteLayoutProps>) {
  // The SLA integration is registered at startup (server/src/lib/initializeApp.ts). Registering it
  // from here reached only the bundles this layout is part of, which is why a board created from
  // settings could end up without its SLA policy (F122).
  return <WorkspaceProviders>{children}</WorkspaceProviders>;
}
