import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedOverview from '@/components/co-managed/CoManagedOverview';

export default async function CoManagedPage({ searchParams }: { searchParams?: Promise<{ clientId?: string }> }) {
  const clientId = (await searchParams)?.clientId;
  const initialClientId = typeof clientId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId) ? clientId : undefined;
  return <CoManagedFeatureBoundary><CoManagedOverview initialClientId={initialClientId} /></CoManagedFeatureBoundary>;
}
