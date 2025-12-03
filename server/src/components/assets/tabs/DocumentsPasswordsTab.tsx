import React from 'react';
import AssetDocuments from '../AssetDocuments';
import { Asset } from '../../../interfaces/asset.interfaces';
import { Card } from 'server/src/components/ui/Card';
import { Text, Tabs } from '@mantine/core';

interface DocumentsPasswordsTabProps {
  asset: Asset;
}

export const DocumentsPasswordsTab: React.FC<DocumentsPasswordsTabProps> = ({ asset }) => {
  return (
    <div className="space-y-6">
      <AssetDocuments 
        assetId={asset.asset_id} 
        tenant={asset.tenant} 
      />
      
      {/* Passwords Section Placeholder - could be a separate component later */}
      <Card title="Passwords & Secrets">
         <div className="text-center py-8 text-gray-500">
           <Text c="dimmed">Secure password management coming soon.</Text>
         </div>
      </Card>
    </div>
  );
};
