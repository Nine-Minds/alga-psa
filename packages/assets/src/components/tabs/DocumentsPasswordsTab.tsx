import React from 'react';
import AssetDocuments from '../AssetDocuments';
import type { Asset } from '@alga-psa/types';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';

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
      <Card>
         <CardHeader>
           <CardTitle>Passwords & Secrets</CardTitle>
         </CardHeader>
         <CardContent>
           <div className="text-center py-8">
             <p className="text-gray-500">Secure password management coming soon.</p>
           </div>
         </CardContent>
      </Card>
    </div>
  );
};
