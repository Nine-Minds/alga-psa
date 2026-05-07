import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

interface LayoutProps {
  children: React.ReactNode;
}

export default async function Layout({ children }: Readonly<LayoutProps>) {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/jobs', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  return children;
}
