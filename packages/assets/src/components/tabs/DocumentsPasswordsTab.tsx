'use client';

import React from 'react';
import useSWR from 'swr';
import AssetDocuments from '../AssetDocuments';
import { AssetCredentialsSection } from './AssetCredentialsSection';
import { getAssetDocuments } from '../../actions/assetDocumentActions';
import { unwrapAssetActionResult } from '../../actions/assetActionErrors';
import type { Asset, IDocument } from '@alga-psa/types';

interface DocumentsPasswordsTabProps {
  asset: Asset;
}

// Stable reference so the AssetDocuments prop-sync effect does not reset on every render
// while the SWR request is loading or has failed.
const STABLE_EMPTY: IDocument[] = [];

export const DocumentsPasswordsTab: React.FC<DocumentsPasswordsTabProps> = ({ asset }) => {
  // LEVERAGE: pattern asset-documents-fetch — the drawer (assetDrawerActions.safeGetAssetDocuments)
  // and this tab both hand-roll "fetch asset documents and unwrap the AssetActionError".
  const { data, isLoading, mutate } = useSWR(
    asset.asset_id ? ['asset', asset.asset_id, 'documents'] : null,
    ([, id]) => getAssetDocuments(id).then(unwrapAssetActionResult)
  );

  return (
    <div className="space-y-6">
      <AssetDocuments
        assetId={asset.asset_id}
        tenant={asset.tenant}
        initialDocuments={data ?? STABLE_EMPTY}
        isLoading={isLoading}
        onDocumentCreated={async () => {
          await mutate();
        }}
      />

      {/* Credentials vault section (EE + flag-gated; the dynamic import resolves
          to a render-null CE stub / nothing when the release flag is off). */}
      <AssetCredentialsSection assetId={asset.asset_id} clientId={asset.client_id} />
    </div>
  );
};

export default DocumentsPasswordsTab;
