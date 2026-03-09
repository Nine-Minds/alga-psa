import { FeaturePlaceholder } from '@alga-psa/ui/components/feature-flags/FeaturePlaceholder';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Asset Integrations',
};

export default function AssetIntegrationsPage() {
  return (
    <div className="h-full w-full flex items-center justify-center bg-white">
      <FeaturePlaceholder />
    </div>
  );
}
