import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

interface LayoutProps {
  children: React.ReactNode;
}

export default async function Layout({ children }: Readonly<LayoutProps>) {
  const boundary = await enforceServerProductRoute({ pathname: '/client-portal/devices', scope: 'client-portal' });
  if (boundary) {
    return boundary;
  }

  return children;
}
