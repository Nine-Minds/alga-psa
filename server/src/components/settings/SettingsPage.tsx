// server/src/components/settings/SettingsPage.tsx
'use client'

/* global process */

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Settings, Users, MessageSquare, Bell, Monitor, Puzzle, FlaskConical } from 'lucide-react';
import type { TabContent } from "@alga-psa/ui/components/CustomTabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@alga-psa/ui/components/Card";
import { FeatureUpgradeNotice } from '@alga-psa/ui/components/tier-gating/FeatureUpgradeNotice';
import GeneralSettings from './general/GeneralSettings';
import SettingsTabSkeleton from '@alga-psa/ui/components/skeletons/SettingsTabSkeleton';
import { UnsavedChangesProvider } from "@alga-psa/ui";
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import NotificationsTab from './general/NotificationsTab';
import ExtensionManagement from '@/components/settings/extensions/ExtensionManagement';
import { useTier } from '@/context/TierContext';
import { TIER_FEATURES, FEATURE_MINIMUM_TIER } from '@alga-psa/types';
import { useProduct } from '@/context/ProductContext';
import { getAllowedSettingsTabIds } from '@/lib/settingsProductTabs';

// Heavy settings tabs have moved to their own /msp/settings/<id> route segments so a route
// only pulls the feature graph it renders (see settingsTabsRegistry.ts). The tabs that remain
// here are the general landing tab, the already-lazy (dynamic, ssr:false) tabs — which barely
// touch the server-reference manifest — plus notifications and extensions.

function TicketingSettingsLoading() {
  const { t } = useTranslation('msp/settings');
  return <SettingsTabSkeleton title={t('tabs.ticketingSettings')} description={t('tabs.loadingTicketing')} />;
}

function TeamManagementLoading() {
  const { t } = useTranslation('msp/settings');
  return <SettingsTabSkeleton title={t('tabs.teamManagement')} description={t('tabs.loadingTeam')} showTabs={false} />;
}

function ExperimentalFeaturesLoading() {
  const { t } = useTranslation('msp/settings');
  return <SettingsTabSkeleton title={t('tabs.experimentalFeatures')} description={t('tabs.loadingExperimental')} showTabs={false} />;
}

function AssetTypesLoading() {
  const { t } = useTranslation('msp/settings');
  return (
    <SettingsTabSkeleton
      title={t('settings.assetTypes.title', { defaultValue: 'Asset Types' })}
      description={t('settings.assetTypes.loading', { defaultValue: 'Loading asset types...' })}
      showTabs={false}
    />
  );
}

// Dynamic imports for heavy settings components
const TicketingSettings = dynamic(() => import('./general/TicketingSettings'), {
  loading: () => <TicketingSettingsLoading />,
  ssr: false
});

const TeamManagement = dynamic(() => import('./general/TeamManagement'), {
  loading: () => <TeamManagementLoading />,
  ssr: false
});

const ExperimentalFeaturesSettings = dynamic(() => import('./general/ExperimentalFeaturesSettings'), {
  loading: () => <ExperimentalFeaturesLoading />,
  ssr: false
});

const AssetTypesManager = dynamic(() => import('@alga-psa/assets/components/settings/AssetTypesManager'), {
  loading: () => <AssetTypesLoading />,
  ssr: false
});

import { useSearchParams } from 'next/navigation';

type SettingsTabContent = TabContent & {
  requiredFeature?: TIER_FEATURES;
};

// Wrapper component with UnsavedChangesProvider
type SettingsPageProps = {
  initialTabParam?: string;
};

const SettingsPage = ({ initialTabParam }: SettingsPageProps): React.JSX.Element => {
  const { t } = useTranslation('msp/settings');
  return (
    <UnsavedChangesProvider
      dialogTitle={t('unsavedChanges.title')}
      dialogMessage={t('unsavedChanges.message')}
    >
      <SettingsPageContent initialTabParam={initialTabParam} />
    </UnsavedChangesProvider>
  );
};

// Main content component
const SettingsPageContent = ({ initialTabParam }: SettingsPageProps): React.JSX.Element =>  {
  const { t } = useTranslation('msp/settings');
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab') ?? initialTabParam;
  const { hasFeature } = useTier();
  const { productCode } = useProduct();
  const isAlgaDesk = productCode === 'algadesk';
  const allowedTabIds = useMemo(() => getAllowedSettingsTabIds(productCode), [productCode]);

  const baseTabContent: SettingsTabContent[] = [
    {
      id: 'general',
      label: t('tabs.general'),
      icon: Settings,
      content: (
        <Card>
          <CardHeader>
            <CardTitle>{t('general.title')}</CardTitle>
            <CardDescription>
              {t('general.description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <GeneralSettings />
          </CardContent>
        </Card>
      ),
    },
    {
      id: 'experimental-features',
      label: t('tabs.experimentalFeatures'),
      icon: FlaskConical,
      content: (
        <Suspense
          fallback={
            <SettingsTabSkeleton
              title={t('tabs.experimentalFeatures')}
              description={t('tabs.loadingExperimental')}
              showTabs={false}
            />
          }
        >
          <ExperimentalFeaturesSettings />
        </Suspense>
      ),
    },
    {
      id: 'teams',
      label: t('tabs.teams'),
      icon: Users,
      content: (
        <Card>
          <CardHeader>
            <CardTitle>{t('teams.title')}</CardTitle>
            <CardDescription>{t('teams.description')}</CardDescription>
          </CardHeader>
          <CardContent className="overflow-visible">
            <Suspense fallback={<SettingsTabSkeleton title={t('tabs.teamManagement')} description={t('tabs.loadingTeam')} showTabs={false} />}>
              <TeamManagement />
            </Suspense>
          </CardContent>
        </Card>
      ),
    },
    {
      id: 'ticketing',
      label: t('tabs.ticketing'),
      icon: MessageSquare,
      content: (
        <Suspense fallback={<SettingsTabSkeleton title={t('tabs.ticketingSettings')} description={t('tabs.loadingTicketing')} />}>
          <TicketingSettings />
        </Suspense>
      ),
    },
    {
      id: 'assets',
      label: t('settings.assetTypes.tab', { defaultValue: 'Assets' }),
      icon: Monitor,
      content: <AssetTypesManager />,
    },
    {
      id: 'notifications',
      label: t('tabs.notifications'),
      icon: Bell,
      content: <NotificationsTab />,
    },
  ];

  // Always include an "Extensions" tab.
  // - EE: full Manage + Install sub-tabs
  // - OSS: enterprise-only stub
  const extensionsTab: SettingsTabContent = {
    id: 'extensions',
    label: t('tabs.extensions'),
    icon: Puzzle,
    requiredFeature: TIER_FEATURES.EXTENSIONS,
    content: <ExtensionManagement />,
  };

  const allTabs = useMemo(() => {
    const tabs = [...baseTabContent, extensionsTab];
    if (!isAlgaDesk) {
      return tabs;
    }

    return tabs.filter((tab) => allowedTabIds.has(tab.id));
  }, [allowedTabIds, baseTabContent, extensionsTab, isAlgaDesk]);

  const initialTabId = useMemo(() => {
    const requestedTab = tabParam?.toLowerCase();

    if (requestedTab && allTabs.some(tab => tab.id === requestedTab)) {
      return requestedTab;
    }

    return 'general';
  }, [allTabs, tabParam]);

  const [activeTab, setActiveTab] = useState<string>(initialTabId);

  useEffect(() => {
    setActiveTab((prev) => (prev === initialTabId ? prev : initialTabId));
  }, [initialTabId]);

  const activeTabContent = allTabs.find(tab => tab.id === activeTab);
  const activeTabBody = useMemo(() => {
    if (!activeTabContent) {
      return null;
    }

    if (activeTabContent.requiredFeature && !hasFeature(activeTabContent.requiredFeature)) {
      return (
        <FeatureUpgradeNotice
          featureName={activeTabContent.label}
          requiredTier={FEATURE_MINIMUM_TIER[activeTabContent.requiredFeature]}
        />
      );
    }

    return activeTabContent.content;
  }, [activeTabContent, hasFeature]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-3xl font-bold mb-6">{t('page.title')}</h1>
      {activeTabBody}
    </div>
  );
};

export default SettingsPage;
