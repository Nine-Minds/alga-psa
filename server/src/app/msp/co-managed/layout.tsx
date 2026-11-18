import { notFound } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { requireCapabilityForPage } from '@alga-psa/core/capability/server';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';
import WorkspaceRouteLayout from '../_components/WorkspaceRouteLayout';

interface LayoutProps {
  children: React.ReactNode;
}

// One side-aware root: the capability must at least serve (existing state stays
// reachable), then the product boundary decides who may see /msp/co-managed.
export default async function Layout({ children }: Readonly<LayoutProps>) {
  const session = await getSession();
  const tenant = session?.user?.tenant;
  if (!tenant) notFound();
  await requireCapabilityForPage('co-managed', tenant, 'serves');
  const boundary = await enforceServerProductRoute({ pathname: '/msp/co-managed', scope: 'msp' });
  if (boundary) return boundary;
  return <WorkspaceRouteLayout>{children}</WorkspaceRouteLayout>;
}
