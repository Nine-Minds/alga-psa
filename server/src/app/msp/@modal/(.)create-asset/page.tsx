import type { Metadata } from 'next';
import CreateAssetRouteClient from '../../_components/CreateAssetRouteClient';
import WorkspaceRouteLayout from '../../_components/WorkspaceRouteLayout';

export const metadata: Metadata = {
  title: 'Create Asset',
};

export default function CreateAssetModalPage() {
  return (
    <WorkspaceRouteLayout>
      <CreateAssetRouteClient closeMode="back" />
    </WorkspaceRouteLayout>
  );
}
