import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Appointments',
};

interface LayoutProps {
  children: React.ReactNode;
}

export default async function Layout({ children }: Readonly<LayoutProps>) {
  const boundary = await enforceServerProductRoute({ pathname: '/client-portal/appointments', scope: 'client-portal' });
  if (boundary) {
    return boundary;
  }

  return children;
}
