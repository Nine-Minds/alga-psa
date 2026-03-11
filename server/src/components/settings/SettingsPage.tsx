// server/src/components/settings/SettingsPage.tsx
'use client'

/* global process */

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Settings, Globe, UserCog, Users, MessageSquare, Layers, Handshake, Bell, Clock, CreditCard, Download, Mail, Plug, Puzzle, KeyRound, FlaskConical } from 'lucide-react';
import CustomTabs, { TabContent } from "@alga-psa/ui/components/CustomTabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@alga-psa/ui/components/Card";
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
import Link from 'next/link';
// Removed import: import { getCurrentUser } from '@alga-psa/users/actions';
import { ProjectSettings } from '@alga-psa/projects/components';

import { SecretsManagement } from './secrets';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { useTierFeature } from '@/context/TierContext';
import { TIER_FEATURES } from '@alga-psa/types';

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

  // Extensions dynamic imports moved to ExtensionManagement shared component

  // Map URL slugs (kebab-case) to Tab Labels
  const slugToLabelMap = useMemo<Record<string, string>>(() => ({
    general: 'General',
    'experimental-features': 'Experimental Features',
    'client-portal': 'Client Portal',
    users: 'Users',
    teams: 'Teams',
    ...(isMspI18nEnabled && { language: 'Language' }),
    ticketing: 'Ticketing',
    projects: 'Projects',

    interactions: 'Interactions',
    notifications: 'Notifications',
    'time-entry': 'Time Entry',
    billing: 'Billing',
    secrets: 'Secrets',
    'import-export': 'Import/Export',
    email: 'Email',
    integrations: 'Integrations',
    ...(isEEAvailable && { extensions: 'Extensions' }) // Only add if EE is available
  }), [isEEAvailable, isMspI18nEnabled]);

  const initialTabLabel = useMemo(() => {
    const mappedLabel = tabParam
      ? slugToLabelMap[tabParam.toLowerCase()]
      : undefined;

    return mappedLabel ?? 'General';
  }, [tabParam, slugToLabelMap]);

  // Initialize with URL-aware default so hydration stays aligned
  const [activeTab, setActiveTab] = useState<string>(initialTabLabel);

  useEffect(() => {
    const targetLabel = initialTabLabel;

    setActiveTab((prev) => (prev === targetLabel ? prev : targetLabel));
  }, [initialTabLabel]);

  const baseTabContent: TabContent[] = [
    {
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
      label: "Client Portal",
      icon: Globe,
      content: <ClientPortalSettings />,
    },
    {
      label: "Users",
      icon: UserCog,
      content: <UserManagement />,
    },
    {
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
      label: "Language",
      icon: Globe,
      content: <MspLanguageSettings />,
    }] : []),
    {
      label: "Ticketing",
      icon: MessageSquare,
      content: (
        <Suspense fallback={<SettingsTabSkeleton title="Ticketing Settings" description="Loading ticketing configuration..." />}>
          <TicketingSettings />
        </Suspense>
      ),
    },
    {
      label: "Projects",
      icon: Layers,
      content: <ProjectSettings />,
    },

    {
      label: "Interactions",
      icon: Handshake,
      content: (
        <Suspense fallback={<SettingsTabSkeleton title="Interactions" description="Loading interaction settings..." showTabs={false} />}>
          <InteractionSettings />
        </Suspense>
      ),
    },
    {
      label: "Notifications",
      icon: Bell,
      content: <NotificationsTab />,
    },
    {
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
      label: "Import/Export",
      icon: Download,
      content: <ImportExportSettings />,
    },
    {
      label: "Email",
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
      label: "Integrations",
      icon: Plug,
      content: <IntegrationsSettingsPage canUseEntraSync={canUseEntraSync} canUseCipp={canUseCipp} canUseTeams={canUseTeams} />,
    }
  ];

  // Always include an "Extensions" tab.
  // - EE: full Manage + Install sub-tabs
  // - OSS: enterprise-only stub
  const extensionsTab: TabContent = {
    label: "Extensions",
    icon: Puzzle,
    content: <ExtensionManagement />,
  };

  // Create a map of tab content by label for easy lookup
  const allTabs = [...baseTabContent, extensionsTab];
  const activeTabContent = allTabs.find(tab => tab.label === activeTab);

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-3xl font-bold mb-6">{t('page.title')}</h1>
      {activeTabContent?.content}
    </div>
  );
};

export default SettingsPage;
