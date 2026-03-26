import React from 'react';
import AssetDocuments from '../AssetDocuments';
import type { Asset } from '@alga-psa/types';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface DocumentsPasswordsTabProps {
  asset: Asset;
}

export const DocumentsPasswordsTab: React.FC<DocumentsPasswordsTabProps> = ({ asset }) => {
  const { t } = useTranslation('msp/assets');

  return (
    <div className="space-y-6">
      <AssetDocuments 
        assetId={asset.asset_id} 
        tenant={asset.tenant} 
      />
      
      {/* Passwords Section Placeholder - could be a separate component later */}
      <Card>
         <CardHeader>
           <CardTitle>
             {t('documentsPasswordsTab.passwords.title', {
               defaultValue: 'Passwords & Secrets'
             })}
           </CardTitle>
         </CardHeader>
         <CardContent>
           <div className="text-center py-8">
             <p className="text-gray-500">
               {t('documentsPasswordsTab.passwords.comingSoon', {
                 defaultValue: 'Secure password management coming soon.'
               })}
             </p>
           </div>
         </CardContent>
      </Card>
    </div>
  );
};
