import type { Metadata } from 'next';
import CreateServiceRouteClient from '../../_components/CreateServiceRouteClient';
import WorkspaceRouteLayout from '../../_components/WorkspaceRouteLayout';

export const metadata: Metadata = {
  title: 'Create Service',
};

export default function CreateServiceModalPage() {
  return (
    <WorkspaceRouteLayout>
      <CreateServiceRouteClient closeMode="back" />
    </WorkspaceRouteLayout>
  );
}
