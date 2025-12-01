import React from 'react';
import CustomTabs from 'server/src/components/ui/CustomTabs';
import { ServiceHistoryTab } from './tabs/ServiceHistoryTab';
import { SoftwareInventoryTab } from './tabs/SoftwareInventoryTab';
import { MaintenanceSchedulesTab } from './tabs/MaintenanceSchedulesTab';
import { RelatedAssetsTab } from './tabs/RelatedAssetsTab';
import { DocumentsPasswordsTab } from './tabs/DocumentsPasswordsTab';
import { AuditLogTab } from './tabs/AuditLogTab';
import { Asset } from '../../interfaces/asset.interfaces';
import { History, LayoutGrid, CalendarDays, FileText, Network, Lock } from 'lucide-react';

interface AssetDetailTabsProps {
  asset: Asset;
}

export const AssetDetailTabs: React.FC<AssetDetailTabsProps> = ({ asset }) => {
  const tabs = [
    {
      label: 'Service History',
      icon: History,
      content: <ServiceHistoryTab asset={asset} />
    },
    {
      label: 'Software',
      icon: LayoutGrid,
      content: <SoftwareInventoryTab asset={asset} />
    },
    {
      label: 'Maintenance',
      icon: CalendarDays,
      content: <MaintenanceSchedulesTab assetId={asset.asset_id} />
    },
    {
      label: 'Related Assets',
      icon: Network,
      content: <RelatedAssetsTab asset={asset} />
    },
    {
      label: 'Documents & Passwords',
      icon: Lock,
      content: <DocumentsPasswordsTab asset={asset} />
    },
    {
      label: 'Audit Log',
      icon: FileText,
      content: <AuditLogTab assetId={asset.asset_id} />
    }
  ];

  return (
    <div className="mt-8">
      <CustomTabs 
        defaultTab="Service History"
        tabs={tabs}
      />
    </div>
  );
};
