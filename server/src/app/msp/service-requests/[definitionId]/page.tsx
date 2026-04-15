import ServiceRequestDefinitionEditorPage from '../ServiceRequestDefinitionEditorPage';
import FeatureFlagPageWrapper from '@alga-psa/ui/components/feature-flags/FeatureFlagPageWrapper';

export default function ServiceRequestDefinitionEditorRoute() {
  return (
    <FeatureFlagPageWrapper featureFlag="service-requests">
      <ServiceRequestDefinitionEditorPage />
    </FeatureFlagPageWrapper>
  );
}
