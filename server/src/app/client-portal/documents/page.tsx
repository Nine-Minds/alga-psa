import { ClientDocumentsPage } from '@alga-psa/client-portal/components';
import FeatureFlagPageWrapper from '@alga-psa/ui/components/feature-flags/FeatureFlagPageWrapper';

export default function DocumentsPage() {
  return (
    <FeatureFlagPageWrapper featureFlag="document-folder-templates">
      <ClientDocumentsPage />
    </FeatureFlagPageWrapper>
  );
}
