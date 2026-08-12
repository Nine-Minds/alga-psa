'use client';

/**
 * Asset Passwords Section - Dynamic Import Wrapper
 *
 * Dynamically imports the EE or CE version of the credentials vault asset
 * section. EE renders the flag-gated native credential list attached to the
 * asset; CE renders nothing.
 */

import dynamic from 'next/dynamic';

interface AssetCredentialsSectionProps {
  assetId: string;
  clientId: string;
}

const AssetCredentialsSection = dynamic(
  () =>
    import('@enterprise/components/credentials/AssetCredentialsSection').then(
      (mod) => mod.AssetCredentialsSection
    ),
  {
    ssr: false,
    loading: () => null,
  }
);

export { AssetCredentialsSection };
export type { AssetCredentialsSectionProps };
export default AssetCredentialsSection;
