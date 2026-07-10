import type { Metadata } from 'next';
import CreateClientRouteClient from '../_components/CreateClientRouteClient';

export const metadata: Metadata = {
  title: 'Create Client',
};

export default function CreateClientPage() {
  return <CreateClientRouteClient closeMode="replace" />;
}
