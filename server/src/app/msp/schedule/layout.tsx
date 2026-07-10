import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';
import WorkspaceRouteLayout from '../_components/WorkspaceRouteLayout';

interface LayoutProps {
  children: React.ReactNode;
}

export default async function Layout({ children }: Readonly<LayoutProps>) {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/schedule', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  return <WorkspaceRouteLayout>{children}</WorkspaceRouteLayout>;
}
