import type { Metadata } from 'next';
import CreateProjectRouteClient from '../../_components/CreateProjectRouteClient';
import WorkspaceRouteLayout from '../../_components/WorkspaceRouteLayout';

export const metadata: Metadata = {
  title: 'Create Project',
};

export default function CreateProjectModalPage() {
  return (
    <WorkspaceRouteLayout>
      <CreateProjectRouteClient closeMode="back" />
    </WorkspaceRouteLayout>
  );
}
