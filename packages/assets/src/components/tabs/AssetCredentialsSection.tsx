'use client';

/**
 * Asset Passwords Section — dynamic import wrapper.
 *
 * Dynamically imports the EE/CE vault section via `@enterprise` (EE renders
 * the tier-gated credential list attached to the asset; CE renders nothing).
 */

import React from 'react';
import dynamic from 'next/dynamic';

interface AssetCredentialsSectionProps {
  assetId: string;
  clientId: string;
}

const VaultAssetCredentialsSection = dynamic(
  () =>
    import('@enterprise/components/credentials/AssetCredentialsSection').then(
      (mod) => mod.AssetCredentialsSection
    ),
  {
    ssr: false,
    loading: () => null,
  }
);

export function AssetCredentialsSection({ assetId, clientId }: AssetCredentialsSectionProps) {
  return <VaultAssetCredentialsSection assetId={assetId} clientId={clientId} />;
}

export type { AssetCredentialsSectionProps };
export default AssetCredentialsSection;
