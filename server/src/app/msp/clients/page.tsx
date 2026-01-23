import { Clients } from '@alga-psa/clients';

export default async function ClientsPage() {
  // Generate a timestamp that changes on each server render (e.g., from router.refresh())
  const refreshTimestamp = Date.now();

  return <Clients key={refreshTimestamp} />;
}

export const dynamic = "force-dynamic";
