import React from 'react';
import BillingDashboard from '../../../components/billing-dashboard/BillingDashboard';
import { getServices } from '../../../lib/actions/serviceActions';

const BillingPage = async () => {
  const servicesResponse = await getServices();

  // Extract the services array from the paginated response
  const services = Array.isArray(servicesResponse)
    ? servicesResponse
    : (servicesResponse.services || []);

  return (
    <BillingDashboard
      initialServices={services}
    />
  );
};

export default BillingPage;
