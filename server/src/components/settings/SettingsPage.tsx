// server/src/components/settings/SettingsPage.tsx
'use client'

/* global process */

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Settings, Globe, UserCog, Users, MessageSquare, Layers, Handshake, Bell, Clock, CreditCard, Download, Mail, Plug, Puzzle, KeyRound, FlaskConical, BookOpen } from 'lucide-react';
import type { TabContent } from "@alga-psa/ui/components/CustomTabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@alga-psa/ui/components/Card";
import { FeatureUpgradeNotice } from '@alga-psa/ui/components/tier-gating/FeatureUpgradeNotice';
import GeneralSettings from './general/GeneralSettings';
import UserManagement from './general/UserManagement';
import ClientPortalSettings from './general/ClientPortalSettings';
import MspLanguageSettings from './general/MspLanguageSettings';
import SettingsTabSkeleton from '@alga-psa/ui/components/skeletons/SettingsTabSkeleton';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { UnsavedChangesProvider } from "@alga-psa/ui";
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import Link from 'next/link';

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
import InteractionSettings from './general/InteractionSettings';
import { TimeEntrySettings } from '@alga-psa/scheduling/components';
import { BillingSettings, TaxDelegationNudge } from '@alga-psa/billing/components'; // Import the new component
import NotificationsTab from './general/NotificationsTab';
// Removed import: import IntegrationsTabLoader from './IntegrationsTabLoader';
import { IntegrationsSettingsPage } from '@alga-psa/integrations/components';
import { useSearchParams } from 'next/navigation';
import ImportExportSettings from '@/components/settings/import-export/ImportExportSettings';
import ExtensionManagement from '@/components/settings/extensions/ExtensionManagement';
// Extensions are only available in Enterprise Edition
import { EmailSettings } from '@alga-psa/integrations/email/settings/entry';
// Removed import: import { getCurrentUser } from '@alga-psa/users/actions';
import { ProjectSettings } from '@alga-psa/projects/components';

import { SecretsManagement } from './secrets';
import { useTier, useTierFeature } from '@/context/TierContext';
import { TIER_FEATURES, FEATURE_MINIMUM_TIER } from '@alga-psa/types';
import { useProduct } from '@/context/ProductContext';
import { getAllowedSettingsTabIds } from '@/lib/settingsProductTabs';

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
  // Extensions are conditionally available based on edition
  // The webpack alias will resolve to either the EE component or empty component
  const isEEAvailable = process.env.NEXT_PUBLIC_EDITION === 'enterprise';
  const canUseEntraSync = useTierFeature(TIER_FEATURES.ENTRA_SYNC);
  const canUseCipp = useTierFeature(TIER_FEATURES.CIPP);
  const canUseTeams = useTierFeature(TIER_FEATURES.TEAMS_INTEGRATION);
  const { hasFeature } = useTier();
  const { productCode } = useProduct();
  const isAlgadesk = productCode === 'algadesk';
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
      id: 'client-portal',
      label: t('tabs.clientPortal'),
      icon: Globe,
      content: <ClientPortalSettings />,
    },
    {
      id: 'users',
      label: t('tabs.users'),
      icon: UserCog,
      content: <UserManagement />,
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
      id: 'language',
      label: t('tabs.language'),
      icon: Globe,
      content: <MspLanguageSettings />,
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
      id: 'knowledge-base',
      label: t('tabs.knowledgeBase', { defaultValue: 'Knowledge Base' }),
      icon: BookOpen,
      content: (
        <Card>
          <CardHeader>
            <CardTitle>{t('tabs.knowledgeBase', { defaultValue: 'Knowledge Base' })}</CardTitle>
            <CardDescription>
              {t('knowledgeBase.description', {
                defaultValue: 'Manage knowledge base content and publishing workflow from the MSP knowledge base area.',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/msp/knowledge-base" className="text-sm text-[rgb(var(--color-primary-600))] hover:underline">
              {t('knowledgeBase.open', { defaultValue: 'Open Knowledge Base' })}
            </Link>
          </CardContent>
        </Card>
      ),
    },
    {
      id: 'projects',
      label: t('tabs.projects'),
      icon: Layers,
      content: <ProjectSettings />,
    },

    {
      id: 'interactions',
      label: t('tabs.interactions'),
      icon: Handshake,
      content: (
        <Suspense fallback={<SettingsTabSkeleton title={t('tabs.interactions')} description={t('tabs.loadingInteractions')} showTabs={false} />}>
          <InteractionSettings />
        </Suspense>
      ),
    },
    {
      id: 'notifications',
      label: t('tabs.notifications'),
      icon: Bell,
      content: <NotificationsTab />,
    },
    {
      id: 'time-entry',
      label: t('tabs.timeEntry'),
      icon: Clock,
      content: (
        <Card>
          <CardHeader>
            <CardTitle>{t('timeEntry.title')}</CardTitle>
            <CardDescription>{t('timeEntry.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <TimeEntrySettings />
          </CardContent>
        </Card>
      ),
    },
    {
      id: 'billing',
      label: t('tabs.billing'),
      icon: CreditCard,
      content: (
        <Card>
          <CardHeader>
            <CardTitle>{t('billing.title')}</CardTitle>
            <CardDescription>{t('billing.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <BillingSettings />
          </CardContent>
        </Card>
      ),
    },
    {
      id: 'secrets',
      label: t('tabs.secrets'),
      icon: KeyRound,
      content: (
        <Card>
          <CardHeader>
            <CardTitle>{t('secrets.title')}</CardTitle>
            <CardDescription>
              {t('secrets.description')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SecretsManagement />
          </CardContent>
        </Card>
      ),
    },
    {
      id: 'import-export',
      label: t('tabs.importExport'),
      icon: Download,
      content: <ImportExportSettings />,
    },
    {
      id: 'email',
      label: t('tabs.email'),
      icon: Mail,
      content: (
        <Card>
          <CardHeader>
            <CardTitle>{t('email.title')}</CardTitle>
            <CardDescription>{t('email.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <EmailSettings />
          </CardContent>
        </Card>
      ),
    },
    {
      // Integrations tab with category-based organization
      id: 'integrations',
      label: t('tabs.integrations'),
      icon: Plug,
      requiredFeature: TIER_FEATURES.INTEGRATIONS,
      content: (
        <>
          <TaxDelegationNudge />
          <IntegrationsSettingsPage canUseEntraSync={canUseEntraSync} canUseCipp={canUseCipp} canUseTeams={canUseTeams} />
        </>
      ),
    }
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

  // Create a map of tab content by label for easy lookup
  const allTabs = useMemo(() => {
    const tabs = [...baseTabContent, extensionsTab];
    if (!isAlgadesk) {
      return tabs;
    }

    return tabs.filter((tab) => allowedTabIds.has(tab.id));
  }, [allowedTabIds, baseTabContent, extensionsTab, isAlgadesk]);

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
