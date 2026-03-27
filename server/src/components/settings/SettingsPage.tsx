// server/src/components/settings/SettingsPage.tsx
'use client'

/* global process */

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Settings, Globe, UserCog, Users, MessageSquare, Layers, Handshake, Bell, Clock, CreditCard, Download, Mail, Plug, Puzzle, KeyRound, FlaskConical } from 'lucide-react';
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

// Dynamic imports for heavy settings components
const TicketingSettings = dynamic(() => import('./general/TicketingSettings'), {
  loading: () => <SettingsTabSkeleton title="Ticketing Settings" description="Loading ticketing configuration..." />,
  ssr: false
});

const TeamManagement = dynamic(() => import('./general/TeamManagement'), {
  loading: () => <SettingsTabSkeleton title="Team Management" description="Loading team configuration..." showTabs={false} />,
  ssr: false
});

const ExperimentalFeaturesSettings = dynamic(() => import('./general/ExperimentalFeaturesSettings'), {
  loading: () => <SettingsTabSkeleton title="Experimental Features" description="Loading experimental feature configuration..." showTabs={false} />,
  ssr: false
});
import InteractionSettings from './general/InteractionSettings';
import { TimeEntrySettings } from '@alga-psa/scheduling/components';
import { BillingSettings } from '@alga-psa/billing/components'; // Import the new component
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
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { useTier, useTierFeature } from '@/context/TierContext';
import { TIER_FEATURES } from '@alga-psa/types';

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
  const { enabled: isMspI18nEnabled } = useFeatureFlag('msp-i18n-enabled', { defaultValue: false });
  const canUseEntraSync = useTierFeature(TIER_FEATURES.ENTRA_SYNC);
  const canUseCipp = useTierFeature(TIER_FEATURES.CIPP);
  const canUseTeams = useTierFeature(TIER_FEATURES.TEAMS_INTEGRATION);
  const { hasFeature } = useTier();

  const baseTabContent: SettingsTabContent[] = [
    {
      id: 'general',
      label: "General",
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
      label: "Experimental Features",
      icon: FlaskConical,
      content: (
        <Suspense
          fallback={
            <SettingsTabSkeleton
              title="Experimental Features"
              description="Loading experimental feature configuration..."
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
      label: "Client Portal",
      icon: Globe,
      content: <ClientPortalSettings />,
    },
    {
      id: 'users',
      label: "Users",
      icon: UserCog,
      content: <UserManagement />,
    },
    {
      id: 'teams',
      label: "Teams",
      icon: Users,
      content: (
        <Card>
          <CardHeader>
            <CardTitle>{t('teams.title')}</CardTitle>
            <CardDescription>{t('teams.description')}</CardDescription>
          </CardHeader>
          <CardContent className="overflow-visible">
            <Suspense fallback={<SettingsTabSkeleton title="Team Management" description="Loading team configuration..." showTabs={false} />}>
              <TeamManagement />
            </Suspense>
          </CardContent>
        </Card>
      ),
    },
    ...(isMspI18nEnabled ? [{
      id: 'language',
      label: "Language",
      icon: Globe,
      content: <MspLanguageSettings />,
    }] : []),
    {
      id: 'ticketing',
      label: "Ticketing",
      icon: MessageSquare,
      content: (
        <Suspense fallback={<SettingsTabSkeleton title="Ticketing Settings" description="Loading ticketing configuration..." />}>
          <TicketingSettings />
        </Suspense>
      ),
    },
    {
      id: 'projects',
      label: "Projects",
      icon: Layers,
      content: <ProjectSettings />,
    },

    {
      id: 'interactions',
      label: "Interactions",
      icon: Handshake,
      content: (
        <Suspense fallback={<SettingsTabSkeleton title="Interactions" description="Loading interaction settings..." showTabs={false} />}>
          <InteractionSettings />
        </Suspense>
      ),
    },
    {
      id: 'notifications',
      label: "Notifications",
      icon: Bell,
      content: <NotificationsTab />,
    },
    {
      id: 'time-entry',
      label: "Time Entry",
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
      label: "Billing",
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
      label: "Secrets",
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
      label: "Import/Export",
      icon: Download,
      content: <ImportExportSettings />,
    },
    {
      id: 'email',
      label: "Email",
      icon: Mail,
      requiredFeature: TIER_FEATURES.MANAGED_EMAIL,
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
      label: "Integrations",
      icon: Plug,
      requiredFeature: TIER_FEATURES.INTEGRATIONS,
      content: <IntegrationsSettingsPage canUseEntraSync={canUseEntraSync} canUseCipp={canUseCipp} canUseTeams={canUseTeams} />,
    }
  ];

  // Always include an "Extensions" tab.
  // - EE: full Manage + Install sub-tabs
  // - OSS: enterprise-only stub
  const extensionsTab: SettingsTabContent = {
    id: 'extensions',
    label: "Extensions",
    icon: Puzzle,
    requiredFeature: TIER_FEATURES.EXTENSIONS,
    content: <ExtensionManagement />,
  };

  // Create a map of tab content by label for easy lookup
  const allTabs = useMemo(() => [...baseTabContent, extensionsTab], [baseTabContent, extensionsTab]);

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
          requiredTier="pro"
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
