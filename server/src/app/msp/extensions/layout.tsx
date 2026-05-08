import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Extensions',
};

interface LayoutProps {
  children: React.ReactNode;
}

export default async function Layout({ children }: Readonly<LayoutProps>) {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/extensions', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  return children;
}
