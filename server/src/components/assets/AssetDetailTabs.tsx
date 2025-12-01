import React from 'react';
import CustomTabs from 'server/src/components/ui/CustomTabs';
import { ServiceHistoryTab } from './tabs/ServiceHistoryTab';
import { SoftwareInventoryTab } from './tabs/SoftwareInventoryTab';
import { MaintenanceSchedulesTab } from './tabs/MaintenanceSchedulesTab';
import { AuditLogTab } from './tabs/AuditLogTab';
import { Asset } from '../../interfaces/asset.interfaces';
import { History, LayoutGrid, CalendarDays, FileText } from 'lucide-react';

interface AssetDetailTabsProps {
  asset: Asset;
}

export const AssetDetailTabs: React.FC<AssetDetailTabsProps> = ({ asset }) => {
  const tabs = [
    {
      label: 'Service History',
      icon: History,
      content: <ServiceHistoryTab assetId={asset.asset_id} />
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
