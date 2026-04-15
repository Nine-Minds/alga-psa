'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import CustomTabs from '@alga-psa/ui/components/CustomTabs';
import { ServiceHistoryTab } from './tabs/ServiceHistoryTab';
import { SoftwareInventoryTab } from './tabs/SoftwareInventoryTab';
import { MaintenanceSchedulesTab } from './tabs/MaintenanceSchedulesTab';
import { RelatedAssetsTab } from './tabs/RelatedAssetsTab';
import { DocumentsPasswordsTab } from './tabs/DocumentsPasswordsTab';
import { AuditLogTab } from './tabs/AuditLogTab';
import type { Asset } from '@alga-psa/types';
import { History, LayoutGrid, CalendarDays, FileText, Network, Lock } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface AssetDetailTabsProps {
  asset: Asset;
}

const DEFAULT_TAB = 'service-history';

export const AssetDetailTabs: React.FC<AssetDetailTabsProps> = ({ asset }) => {
  const { t } = useTranslation('msp/assets');
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');

  // Determine initial active tab based on URL parameter
  const [activeTab, setActiveTab] = useState<string>(() => tabParam?.toLowerCase() || DEFAULT_TAB);

  // Update active tab when URL parameter changes
  useEffect(() => {
    const targetTab = tabParam?.toLowerCase() || DEFAULT_TAB;
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
  }, [tabParam, activeTab]);

  const updateURL = (tabId: string) => {
    // Build new URL with tab parameter
    const currentSearchParams = new URLSearchParams(window.location.search);

    if (tabId !== DEFAULT_TAB) {
      currentSearchParams.set('tab', tabId);
    } else {
      currentSearchParams.delete('tab');
    }

    // Construct the new URL preserving the current path
    const newUrl = currentSearchParams.toString()
      ? `${window.location.pathname}?${currentSearchParams.toString()}`
      : window.location.pathname;

    window.history.pushState({}, '', newUrl);
  };

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    updateURL(tabId);
  };

  const tabs = [
    {
      id: 'service-history',
      label: t('assetDetailTabs.tabs.serviceHistory', { defaultValue: 'Service History' }),
      icon: History,
      content: <ServiceHistoryTab asset={asset} />
    },
    {
      id: 'software',
      label: t('assetDetailTabs.tabs.software', { defaultValue: 'Software' }),
      icon: LayoutGrid,
      content: <SoftwareInventoryTab asset={asset} />
    },
    {
      id: 'maintenance',
      label: t('assetDetailTabs.tabs.maintenance', { defaultValue: 'Maintenance' }),
      icon: CalendarDays,
      content: <MaintenanceSchedulesTab assetId={asset.asset_id} />
    },
    {
      id: 'related-assets',
      label: t('assetDetailTabs.tabs.relatedAssets', { defaultValue: 'Related Assets' }),
      icon: Network,
      content: <RelatedAssetsTab asset={asset} />
    },
    {
      id: 'documents-passwords',
      label: t('assetDetailTabs.tabs.documentsPasswords', {
        defaultValue: 'Documents & Passwords'
      }),
      icon: Lock,
      content: <DocumentsPasswordsTab asset={asset} />
    },
    {
      id: 'audit-log',
      label: t('assetDetailTabs.tabs.auditLog', { defaultValue: 'Audit Log' }),
      icon: FileText,
      content: <AuditLogTab assetId={asset.asset_id} />
    }
  ];

  return (
    <div className="mt-8">
      <CustomTabs
        defaultTab={activeTab}
        tabs={tabs}
        onTabChange={handleTabChange}
      />
    </div>
  );
};
