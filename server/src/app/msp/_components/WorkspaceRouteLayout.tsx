import WorkspaceProviders from '@/components/layout/WorkspaceProviders';

interface WorkspaceRouteLayoutProps {
  children: React.ReactNode;
}

export default function WorkspaceRouteLayout({ children }: Readonly<WorkspaceRouteLayoutProps>) {
  return <WorkspaceProviders>{children}</WorkspaceProviders>;
}
