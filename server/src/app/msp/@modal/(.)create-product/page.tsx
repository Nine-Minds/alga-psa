import type { Metadata } from 'next';
import CreateProductRouteClient from '../../_components/CreateProductRouteClient';
import WorkspaceRouteLayout from '../../_components/WorkspaceRouteLayout';

export const metadata: Metadata = {
  title: 'Create Product',
};

export default function CreateProductModalPage() {
  return (
    <WorkspaceRouteLayout>
      <CreateProductRouteClient closeMode="back" />
    </WorkspaceRouteLayout>
  );
}
