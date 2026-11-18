import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { requireCapabilityForPage } from '@alga-psa/core/capability/server';
import WorkspaceRouteLayout from '../../_components/WorkspaceRouteLayout';

/**
 * The shared-ticket screen is the standard ticket screen, so it needs the same workspace providers every native /msp ticket route has.
 * It closes on the same capability as its pages, so the workspace providers are never mounted for a tenant that cannot serve.
 */
export default async function CoManagedCustomerTicketsLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const tenant = session?.user?.tenant;
  if (!tenant) notFound();
  await requireCapabilityForPage('co-managed', tenant, 'serves');
  return <WorkspaceRouteLayout>{children}</WorkspaceRouteLayout>;
}
