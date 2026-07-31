import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';
import LocalDrawerOutlet from '../_components/LocalDrawerOutlet';

interface LayoutProps {
  children: React.ReactNode;
}

export default async function Layout({ children }: Readonly<LayoutProps>) {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/service-requests', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  return (
    <>
      {children}
      <LocalDrawerOutlet />
    </>
  );
}
