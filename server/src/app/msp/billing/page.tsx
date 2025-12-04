import React, { Suspense } from 'react';
import BillingDashboard from '../../../components/billing-dashboard/BillingDashboard';
import { getServices } from '../../../lib/actions/serviceActions';

const BillingPage = async () => {
  const servicesResponse = await getServices();

  // Extract the services array from the paginated response
  const services = Array.isArray(servicesResponse)
    ? servicesResponse
    : (servicesResponse.services || []);

  return (
    <Suspense fallback={<div className="p-4">Loading billing dashboard...</div>}>
      <BillingDashboard
        initialServices={services}
      />
    </Suspense>
  );
};

export default BillingPage;
