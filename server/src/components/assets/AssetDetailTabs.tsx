'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
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

// Map URL slugs to tab labels
const tabSlugToLabelMap: Record<string, string> = {
  'service-history': 'Service History',
  'software': 'Software',
  'maintenance': 'Maintenance',
  'related-assets': 'Related Assets',
  'documents-passwords': 'Documents & Passwords',
  'audit-log': 'Audit Log'
};

// Map tab labels to URL slugs
const tabLabelToSlugMap: Record<string, string> = Object.entries(tabSlugToLabelMap).reduce(
  (acc, [slug, label]) => {
    acc[label] = slug;
    return acc;
  },
  {} as Record<string, string>
);

const DEFAULT_TAB = 'Service History';

export const AssetDetailTabs: React.FC<AssetDetailTabsProps> = ({ asset }) => {
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');

  // Determine initial active tab based on URL parameter
  const [activeTab, setActiveTab] = useState<string>(() => {
    const initialLabel = tabParam ? tabSlugToLabelMap[tabParam.toLowerCase()] : undefined;
    return initialLabel || DEFAULT_TAB;
  });

  // Update active tab when URL parameter changes
  useEffect(() => {
    const currentLabel = tabParam ? tabSlugToLabelMap[tabParam.toLowerCase()] : undefined;
    const targetTab = currentLabel || DEFAULT_TAB;
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
  }, [tabParam, activeTab]);

  const updateURL = (tabLabel: string) => {
    const urlSlug = tabLabelToSlugMap[tabLabel];

    // Build new URL with tab parameter
    const currentSearchParams = new URLSearchParams(window.location.search);

    if (urlSlug && urlSlug !== 'service-history') {
      currentSearchParams.set('tab', urlSlug);
    } else {
      currentSearchParams.delete('tab');
    }

    // Construct the new URL preserving the current path
    const newUrl = currentSearchParams.toString()
      ? `${window.location.pathname}?${currentSearchParams.toString()}`
      : window.location.pathname;

    window.history.pushState({}, '', newUrl);
  };

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    updateURL(tab);
  };

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
        defaultTab={activeTab}
        tabs={tabs}
        onTabChange={handleTabChange}
      />
    </div>
  );
};
