import type { Metadata } from 'next';
import CreateOpportunityRouteClient from '../../_components/CreateOpportunityRouteClient';
import WorkspaceRouteLayout from '../../_components/WorkspaceRouteLayout';

export const metadata: Metadata = {
  title: 'Create Opportunity',
};

export default function CreateOpportunityModalPage() {
  return (
    <WorkspaceRouteLayout>
      <CreateOpportunityRouteClient closeMode="back" />
    </WorkspaceRouteLayout>
  );
}
