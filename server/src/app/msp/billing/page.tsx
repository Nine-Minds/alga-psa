import React from 'react';
import BillingDashboard from '../../../components/billing-dashboard/BillingDashboard';
import { getServices } from '../../../lib/actions/serviceActions';
import { FeatureFlagWrapper } from 'server/src/components/FeatureFlagWrapper';
import { FeaturePlaceholder } from 'server/src/components/FeaturePlaceholder';

const BillingPage = async () => {
  const servicesResponse = await getServices();

  // Extract the services array from the paginated response
  const services = Array.isArray(servicesResponse)
    ? servicesResponse
    : (servicesResponse.services || []);

  return (
    <FeatureFlagWrapper
      flagKey="billing-enabled"
      fallback={<div className="flex-1 flex"><FeaturePlaceholder /></div>}
    >
      <BillingDashboard
        initialServices={services}
      />
    </FeatureFlagWrapper>
  );
};

export default BillingPage;
