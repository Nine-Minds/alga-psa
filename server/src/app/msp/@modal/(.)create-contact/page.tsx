import type { Metadata } from 'next';
import CreateContactRouteClient from '../../_components/CreateContactRouteClient';
import WorkspaceRouteLayout from '../../_components/WorkspaceRouteLayout';

export const metadata: Metadata = {
  title: 'Create Contact',
};

export default function CreateContactModalPage() {
  return (
    <WorkspaceRouteLayout>
      <CreateContactRouteClient closeMode="back" />
    </WorkspaceRouteLayout>
  );
}
