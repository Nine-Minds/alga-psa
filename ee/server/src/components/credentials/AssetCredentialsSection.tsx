'use client';

/**
 * Asset detail "Passwords" section (EE-only, Pro tier, flag-gated).
 *
 * The asset surface of the shared entity credentials section. Delegates to
 * EntityCredentialsSection scoped to `(entityType='asset', assetId)` so the
 * asset section gets the same list/create-preattached/link-existing/detach
 * behavior as every other entity section. Flag off renders nothing (the shared
 * packages/assets wrapper shows the legacy placeholder card in its place), so
 * flag-off asset pages never show an empty title-only vault card.
 */

import React from 'react';
import { EntityCredentialsSection } from './EntityCredentialsSection';

interface AssetCredentialsSectionProps {
  assetId: string;
  clientId: string;
}

export function AssetCredentialsSection({ assetId, clientId }: AssetCredentialsSectionProps) {
  return (
    <EntityCredentialsSection
      entityType="asset"
      entityId={assetId}
      defaultClientId={clientId}
      titleKey="credentials.assetSection.title"
    />
  );
}

export default AssetCredentialsSection;
