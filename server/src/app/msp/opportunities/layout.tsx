import WorkspaceRouteLayout from '../_components/WorkspaceRouteLayout';

interface LayoutProps {
  children: React.ReactNode;
}

export default function OpportunitiesLayout({ children }: Readonly<LayoutProps>) {
  return <WorkspaceRouteLayout>{children}</WorkspaceRouteLayout>;
}
