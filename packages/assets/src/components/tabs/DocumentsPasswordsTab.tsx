'use client';

import React from 'react';
import AssetDocuments from '../AssetDocuments';
import { AssetCredentialsSection } from './AssetCredentialsSection';
import type { Asset } from '@alga-psa/types';

interface DocumentsPasswordsTabProps {
  asset: Asset;
}

export const DocumentsPasswordsTab: React.FC<DocumentsPasswordsTabProps> = ({ asset }) => {
  return (
    <div className="space-y-6">
      <AssetDocuments assetId={asset.asset_id} tenant={asset.tenant} />

      {/* Credentials vault section (EE + flag-gated; the dynamic import resolves
          to a render-null CE stub / nothing when the release flag is off). */}
      <AssetCredentialsSection assetId={asset.asset_id} clientId={asset.client_id} />
    </div>
  );
};

export default DocumentsPasswordsTab;
