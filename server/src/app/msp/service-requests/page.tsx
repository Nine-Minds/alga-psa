import ServiceRequestsManagementPage from './ServiceRequestsManagementPage';
import FeatureFlagPageWrapper from '@alga-psa/ui/components/feature-flags/FeatureFlagPageWrapper';

export default function MspServiceRequestsPage() {
  return (
    <FeatureFlagPageWrapper featureFlag="service-requests">
      <ServiceRequestsManagementPage />
    </FeatureFlagPageWrapper>
  );
}
