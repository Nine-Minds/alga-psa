import type { Metadata } from 'next';
import CreateOpportunityRouteClient from '../_components/CreateOpportunityRouteClient';

export const metadata: Metadata = {
  title: 'Create Opportunity',
};

export default function CreateOpportunityPage() {
  return <CreateOpportunityRouteClient closeMode="replace" />;
}
