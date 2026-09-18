import WorkspaceRouteLayout from '../_components/WorkspaceRouteLayout';

interface LayoutProps {
  children: React.ReactNode;
}

export default function InteractionsLayout({ children }: Readonly<LayoutProps>) {
  return <WorkspaceRouteLayout>{children}</WorkspaceRouteLayout>;
}
