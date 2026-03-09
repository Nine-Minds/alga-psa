import { Clients } from '@alga-psa/clients';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Clients',
};

export default async function ClientsPage() {
  return <Clients />;
}
