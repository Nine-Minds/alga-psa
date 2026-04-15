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
} from 'lucide-react';
import AccountingIntegrationsSetup from './AccountingIntegrationsSetup';
import RmmIntegrationsSetup from './RmmIntegrationsSetup';
import { EmailProviderConfiguration } from '@alga-psa/integrations/components';
import { GoogleIntegrationSettings } from './GoogleIntegrationSettings';
import { MicrosoftIntegrationSettings } from './MicrosoftIntegrationSettings';
import { MspSsoLoginDomainsSettings } from './MspSsoLoginDomainsSettings';
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
import { FeatureUpgradeNotice } from '@alga-psa/ui/components/tier-gating/FeatureUpgradeNotice';

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

interface IntegrationsSettingsPageProps {
  /** Whether the user can use Entra sync (premium feature) */
  canUseEntraSync?: boolean;
  /** Whether the user can use CIPP (premium feature) */
  canUseCipp?: boolean;
  /** Whether the user can use Teams integration (pro feature) */
  canUseTeams?: boolean;
}

const IntegrationsSettingsPage: React.FC<IntegrationsSettingsPageProps> = ({
  canUseEntraSync = true,
  canUseCipp = true,
  canUseTeams = true,
}) => {
  const { t } = useTranslation('msp/settings');
  const isEEAvailable = isCalendarEnterpriseEdition();
  const entraUiFlag = useFeatureFlag('entra-integration-ui', { defaultValue: false });
  const isEntraUiEnabled = isEEAvailable && entraUiFlag.enabled;
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
          component: AccountingIntegrationsSetup,
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
                <FeatureUpgradeNotice
                  featureName={t('integrations.items.teams.name')}
                  requiredTier="pro"
                  description={t('integrations.items.teams.upgradeDescription')}
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
          component: () => (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>{t('integrations.items.google.cardTitle')}</CardTitle>
                  <CardDescription>
                    {isEEAvailable
                      ? t('integrations.items.google.cardDescription.ee')
                      : t('integrations.items.google.cardDescription.oss')}
                  </CardDescription>
                </CardHeader>
              </Card>
              <GoogleIntegrationSettings />
              <MicrosoftIntegrationSettings />
              <MspSsoLoginDomainsSettings />
            </div>
          ),
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
                <FeatureUpgradeNotice
                  featureName={t('integrations.items.entra.name')}
                  requiredTier="premium"
                  description={t('integrations.items.entra.upgradeDescription')}
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
  ], [canUseCipp, canUseEntraSync, canUseTeams, isEEAvailable, isEntraUiEnabled, t]);

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
        {/* Category header */}
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
