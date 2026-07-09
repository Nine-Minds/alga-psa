'use client';

/**
 * Integrations Settings Page
 *
 * Category-based organization of integrations for better navigation
 * as the number of supported integrations grows.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import CustomTabs, { TabContent } from '@alga-psa/ui/components/CustomTabs';
import {
  Building2,
  Monitor,
  Mail,
  Calendar,
  CreditCard,
  Cloud,
  Shield,
  Lock,
  BookOpen,
} from 'lucide-react';
import AccountingIntegrationsSetup from './AccountingIntegrationsSetup';
import RmmIntegrationsSetup from './RmmIntegrationsSetup';
import { EmailProviderConfiguration } from '../../email/EmailProviderConfiguration';
import { ProviderCredentialsWorkbench } from './ProviderCredentialsWorkbench';
import { CalendarEnterpriseIntegrationSettings } from './CalendarEnterpriseIntegrationSettings';
import { TeamsEnterpriseIntegrationSettings } from './TeamsEnterpriseIntegrationSettings';
import dynamic from 'next/dynamic';
import Spinner from '@alga-psa/ui/components/Spinner';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getVisibleIntegrationCategoryIds,
  isCalendarEnterpriseEdition,
  resolveIntegrationSettingsCategory,
} from '../../../lib/calendarAvailability';

// Dynamic import for StripeConnectionSettings (EE/OSS modular pattern)
// Uses dynamic import with type assertion due to TypeScript bundler mode resolution issues
const StripeConnectionSettings = dynamic(
  () => import('@product/billing/entry').then(mod => (mod as unknown as { StripeConnectionSettings: React.ComponentType }).StripeConnectionSettings),
  {
    loading: () => (
      <Card>
        <CardContent className="py-8">
          <div className="flex flex-col items-center justify-center gap-2">
            <Spinner size="md" />
            <span className="text-sm text-muted-foreground">Loading payment settings...</span>
          </div>
        </CardContent>
      </Card>
    ),
    ssr: false,
  }
);

import { EntraIntegrationSettings } from '@alga-psa/integrations/entra/components/entry';
import { useHuduIntegrationEnabled } from './useHuduIntegrationEnabled';

// Dynamic import for Hudu (EE feature) — `@enterprise` resolves to the real EE
// component in EE builds and to the CE placeholder stub in CE builds.
const HuduIntegrationSettings = dynamic(
  () => import('@enterprise/components/settings/integrations/HuduIntegrationSettings'),
  {
    loading: () => (
      <Card>
        <CardContent className="py-8">
          <div className="flex flex-col items-center justify-center gap-2">
            <Spinner size="md" />
            <span className="text-sm text-muted-foreground">Loading Hudu integration settings...</span>
          </div>
        </CardContent>
      </Card>
    ),
    ssr: false,
  }
);

// Integration category definitions
interface IntegrationCategory {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  integrations: IntegrationItem[];
}

interface IntegrationItem {
  id: string;
  name: string;
  description: string;
  component: React.ComponentType;
  isEE?: boolean;
}

function AddOnRequiredNotice({ featureName, addOnName, description }: {
  featureName: string;
  addOnName: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center">
      <div className="rounded-full bg-muted p-4 mb-6">
        <Lock className="w-8 h-8 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-semibold mb-2">
        {featureName} requires the {addOnName} add-on
      </h2>
      <p className="text-muted-foreground max-w-md mb-6">{description}</p>
      <a
        id={`manage-${addOnName.toLowerCase()}-addon-link`}
        href="/msp/settings/account"
        className="inline-flex items-center justify-center px-6 py-3 bg-primary text-primary-foreground hover:bg-primary/90 font-medium rounded-lg transition-colors"
      >
        Manage add-ons
      </a>
    </div>
  );
}

interface IntegrationsSettingsPageProps {
  /** Whether the user can use Entra sync (Enterprise add-on) */
  canUseEntraSync?: boolean;
  /** Whether the user can use CIPP (premium feature) */
  canUseCipp?: boolean;
  /** Whether the user can use Teams integration (Teams add-on) */
  canUseTeams?: boolean;
  /** Slot for QBO sync health panel (injected from billing to avoid a circular dep) */
  qboSyncHealthSlot?: React.ReactNode;
  /** Slot for QBO onboarding wizard entry (injected from billing to avoid a circular dep) */
  qboOnboardingSlot?: React.ReactNode;
}

const IntegrationsSettingsPage: React.FC<IntegrationsSettingsPageProps> = ({
  canUseEntraSync = true,
  canUseCipp = true,
  canUseTeams = true,
  qboSyncHealthSlot,
  qboOnboardingSlot,
}) => {
  const { t } = useTranslation('msp/settings');
  const isEEAvailable = isCalendarEnterpriseEdition();
  const entraUiFlag = useFeatureFlag('entra-integration-ui', { defaultValue: false });
  const isEntraUiEnabled = isEEAvailable && entraUiFlag.enabled;
  const huduGate = useHuduIntegrationEnabled();
  const isHuduEnabled = huduGate.enabled;
  const searchParams = useSearchParams();
  const categoryParam = searchParams?.get('category');
  const visibleCategoryIds = useMemo(() => getVisibleIntegrationCategoryIds(isEEAvailable), [isEEAvailable]);

  // Initialize selected category from URL param or default to 'accounting'
  const [selectedCategory, setSelectedCategory] = useState<string>(
    resolveIntegrationSettingsCategory(categoryParam, isEEAvailable)
  );

  // Update selected category when URL param changes
  useEffect(() => {
    const nextCategory = resolveIntegrationSettingsCategory(categoryParam, isEEAvailable);
    setSelectedCategory((currentCategory) => (currentCategory === nextCategory ? currentCategory : nextCategory));
  }, [categoryParam, isEEAvailable]);

  // Define integration categories
  const categories: IntegrationCategory[] = useMemo(() => [
    {
      id: 'accounting',
      label: t('integrations.categories.accounting.label'),
      description: t('integrations.categories.accounting.description'),
      icon: Building2,
      integrations: [
        {
          id: 'accounting-setup',
          name: t('integrations.items.accountingSetup.name'),
          description: t('integrations.items.accountingSetup.description'),
          component: () => <AccountingIntegrationsSetup qboSyncHealthSlot={qboSyncHealthSlot} qboOnboardingSlot={qboOnboardingSlot} />,
        }
      ],
    },
    {
      id: 'rmm',
      label: t('integrations.categories.rmm.label'),
      description: t('integrations.categories.rmm.description'),
      icon: Monitor,
      integrations: [
        {
          id: 'rmm-setup',
          name: t('integrations.items.rmmSetup.name'),
          description: t('integrations.items.rmmSetup.description'),
          component: RmmIntegrationsSetup,
        }
      ],
    },
    ...(isHuduEnabled ? [{
      id: 'it-documentation',
      label: t('integrations.categories.itDocumentation.label'),
      description: t('integrations.categories.itDocumentation.description'),
      icon: BookOpen,
      integrations: [
        {
          id: 'hudu',
          name: t('integrations.items.hudu.name'),
          description: t('integrations.items.hudu.description'),
          component: HuduIntegrationSettings,
          isEE: true,
        },
      ],
    }] : []),
    {
      id: 'communication',
      label: t('integrations.categories.communication.label'),
      description: t('integrations.categories.communication.description'),
      icon: Mail,
      integrations: [
        {
          id: 'email',
          name: t('integrations.items.email.name'),
          description: t('integrations.items.email.description'),
          component: () => (
            <Card>
              <CardHeader>
                <CardTitle>{t('integrations.items.email.cardTitle')}</CardTitle>
                <CardDescription>
                  {t('integrations.items.email.cardDescription')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <EmailProviderConfiguration />
              </CardContent>
            </Card>
          ),
        },
        {
          id: 'teams',
          name: t('integrations.items.teams.name'),
          description: t('integrations.items.teams.description'),
          component: canUseTeams
            ? TeamsEnterpriseIntegrationSettings
            : () => (
                <AddOnRequiredNotice
                  featureName={t('integrations.items.teams.name')}
                  addOnName="Teams"
                  description="Purchase the Teams add-on to activate the Microsoft Teams tab, bot, message extension, quick actions, and activity notifications."
                />
              ),
          isEE: true,
        },
      ],
    },
    ...(isEEAvailable ? [{
      id: 'calendar',
      label: t('integrations.categories.calendar.label'),
      description: t('integrations.categories.calendar.description'),
      icon: Calendar,
      integrations: [
        {
          id: 'calendar-sync',
          name: t('integrations.items.calendarSync.name'),
          description: t('integrations.items.calendarSync.description'),
          component: CalendarEnterpriseIntegrationSettings,
        },
      ],
    }] : []),
    {
      id: 'providers',
      label: t('integrations.categories.providers.label'),
      description: isEEAvailable
        ? t('integrations.categories.providers.description.ee')
        : t('integrations.categories.providers.description.oss'),
      icon: Cloud,
      integrations: [
        {
          id: 'google',
          name: t('integrations.items.google.name'),
          description: isEEAvailable
            ? t('integrations.items.google.description.ee')
            : t('integrations.items.google.description.oss'),
          component: () => <ProviderCredentialsWorkbench canUseTeams={canUseTeams} isEnterpriseEdition={isEEAvailable} />,
        },
      ],
    },
    {
      id: 'identity',
      label: t('integrations.categories.identity.label'),
      description: t('integrations.categories.identity.description'),
      icon: Shield,
      integrations: [
        ...(isEntraUiEnabled ? [{
          id: 'entra',
          name: t('integrations.items.entra.name'),
          description: t('integrations.items.entra.description'),
          component: canUseEntraSync
            ? () => <EntraIntegrationSettings canUseCipp={canUseCipp} />
            : () => (
                <AddOnRequiredNotice
                  featureName={t('integrations.items.entra.name')}
                  addOnName="Enterprise"
                  description="Purchase the Enterprise add-on to activate Microsoft Entra Sync, including tenant discovery, client mapping, contact sync, and reconciliation workflows."
                />
              ),
          isEE: true,
        }] : []),
      ],
    },
    {
      id: 'payments',
      label: t('integrations.categories.payments.label'),
      description: t('integrations.categories.payments.description'),
      icon: CreditCard,
      integrations: [
        ...(isEEAvailable ? [{
          id: 'stripe',
          name: t('integrations.items.stripe.name'),
          description: t('integrations.items.stripe.description'),
          component: StripeConnectionSettings,
          isEE: true,
        }] : []),
      ],
    },
  ], [canUseCipp, canUseEntraSync, canUseTeams, isEEAvailable, isEntraUiEnabled, isHuduEnabled, t]);

  // Filter out empty categories
  const visibleCategories = categories.filter((category) => {
    return category.integrations.length > 0 && visibleCategoryIds.includes(category.id);
  });

  // Get current category
  const currentCategory = visibleCategories.find(cat => cat.id === selectedCategory) || visibleCategories[0];

  // Build tab content
  const tabContent: TabContent[] = visibleCategories.map(category => ({
    id: category.id,
    label: category.label,
    icon: <category.icon className="w-4 h-4" />,
    content: (
      <div className="space-y-6">
        {category.id !== 'providers' && (
          <div className="rounded-xl border bg-muted/30 px-6 py-8 text-center">
            <div className="mx-auto flex max-w-3xl flex-col items-center gap-3">
              <div className="flex items-center justify-center gap-3">
                <category.icon className="h-7 w-7 text-primary" />
                <h2 className="text-3xl font-bold tracking-tight">
                  {t('integrations.categoryHeading', { label: category.label })}
                </h2>
              </div>
              <p className="max-w-2xl text-sm text-muted-foreground">
                {category.description}
              </p>
            </div>
          </div>
        )}

        {/* Integration components */}
        {category.integrations.length > 0 ? (
          <div className="space-y-6">
            {category.integrations.map(integration => (
              <integration.component key={integration.id} />
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            {t('integrations.emptyCategory')}
            {category.id === 'rmm' && !isEEAvailable && (
              <p className="mt-2 text-sm">
                {t('integrations.rmmEnterpriseNote')}
              </p>
            )}
          </div>
        )}
      </div>
    ),
  }));

  return (
    <div className="space-y-6">
      {/* Category tabs */}
      <CustomTabs
        tabs={tabContent}
        defaultTab={currentCategory?.id ?? 'accounting'}
        onTabChange={(tabId) => {
          const category = visibleCategories.find(cat => cat.id === tabId);
          if (category) {
            setSelectedCategory(category.id);
            const currentSearchParams = new URLSearchParams(window.location.search);
            currentSearchParams.set('tab', 'integrations');
            currentSearchParams.set('category', category.id);
            const newUrl = `${window.location.pathname}?${currentSearchParams.toString()}`;
            window.history.pushState({}, '', newUrl);
          }
        }}
      />
    </div>
  );
};

export default IntegrationsSettingsPage;
