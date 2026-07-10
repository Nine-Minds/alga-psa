import type { Metadata } from 'next';
import CreateClientRouteClient from '../../_components/CreateClientRouteClient';
import WorkspaceRouteLayout from '../../_components/WorkspaceRouteLayout';

export const metadata: Metadata = {
  title: 'Create Client',
};

export default function CreateClientModalPage() {
  return (
    <WorkspaceRouteLayout>
      <CreateClientRouteClient closeMode="back" />
    </WorkspaceRouteLayout>
  );
}
