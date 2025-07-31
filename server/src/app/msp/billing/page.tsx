import React from 'react';
import BillingDashboard from '../../../components/billing-dashboard/BillingDashboard';
import BillingPageWrapper from '../../../components/billing/BillingPageWrapper';
import { getServices } from '../../../lib/actions/serviceActions';

const BillingPage = async () => {
  console.log('Fetching services');
  const servicesResponse = await getServices();

  // Extract the services array from the paginated response
  const services = Array.isArray(servicesResponse)
    ? servicesResponse
    : (servicesResponse.services || []);

  return (
    <BillingPageWrapper>
      <BillingDashboard
        initialServices={services}
      />
    </BillingPageWrapper>
  );
};

export default BillingPage;
