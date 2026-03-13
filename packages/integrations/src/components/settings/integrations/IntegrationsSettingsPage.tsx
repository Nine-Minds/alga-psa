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
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
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
  /** Whether the user can use Teams integration (premium feature) */
  canUseTeams?: boolean;
}

const IntegrationsSettingsPage: React.FC<IntegrationsSettingsPageProps> = ({
  canUseEntraSync = true,
  canUseCipp = true,
  canUseTeams = true,
}) => {
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
      label: 'Accounting',
      description: 'Select an accounting package to configure synchronization for invoices, payments, and tax data.',
      icon: Building2,
      integrations: [
        {
          id: 'accounting-setup',
          name: 'Accounting Integrations',
          description: 'Configure accounting synchronization and exports',
          component: AccountingIntegrationsSetup,
        }
      ],
    },
    {
      id: 'rmm',
      label: 'RMM',
      description: 'Connect remote monitoring and management tools',
      icon: Monitor,
      integrations: [
        {
          id: 'rmm-setup',
          name: 'RMM Integrations',
          description: 'Select and configure your RMM provider',
          component: RmmIntegrationsSetup,
        }
      ],
    },
    {
      id: 'communication',
      label: 'Communication',
      description: 'Connect inbox and collaboration surfaces for ticket processing, operator workflows, and Microsoft Teams access.',
      icon: Mail,
      integrations: [
        {
          id: 'email',
          name: 'Inbound Email',
          description: 'Process incoming emails into tickets',
          component: () => (
            <Card>
              <CardHeader>
                <CardTitle>Inbound Email Integration</CardTitle>
                <CardDescription>
                  Configure email providers to automatically process incoming emails into tickets
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
          name: 'Microsoft Teams',
          description: 'Configure Teams collaboration surfaces for MSP technicians',
          component: canUseTeams
            ? TeamsEnterpriseIntegrationSettings
            : () => (
                <FeatureUpgradeNotice
                  featureName="Microsoft Teams"
                  requiredTier="premium"
                  description="Configure Microsoft Teams collaboration surfaces for MSP technicians. Upgrade to Premium to unlock this feature."
                />
              ),
          isEE: true,
        },
      ],
    },
    ...(isEEAvailable ? [{
      id: 'calendar',
      label: 'Calendar',
      description: 'Enterprise-only calendar sync for Google and Outlook keeps dispatch and client appointments aligned.',
      icon: Calendar,
      integrations: [
        {
          id: 'calendar-sync',
          name: 'Calendar Sync',
          description: 'Sync schedule entries with Google or Microsoft calendars',
          component: CalendarEnterpriseIntegrationSettings,
        },
      ],
    }] : []),
    {
      id: 'providers',
      label: 'Providers',
      description: isEEAvailable
        ? 'Configure shared provider credentials used by email, calendar, MSP SSO, and other integrations.'
        : 'Configure shared provider credentials used by email, MSP SSO, and other integrations.',
      icon: Cloud,
      integrations: [
        {
          id: 'google',
          name: 'Google',
          description: isEEAvailable
            ? 'Tenant-owned Google Cloud credentials for Gmail and Calendar'
            : 'Tenant-owned Google Cloud credentials for Gmail and MSP SSO support flows',
          component: () => (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Provider Credentials</CardTitle>
                  <CardDescription>
                    {isEEAvailable
                      ? 'Configure Google and Microsoft first, then connect provider accounts from the Inbound Email and Calendar integration screens. MSP SSO domain discovery uses these provider credentials with tenant login-domain mappings.'
                      : 'Configure Google and Microsoft first, then connect provider accounts from the Inbound Email integration screen. MSP SSO domain discovery uses these provider credentials with tenant login-domain mappings.'}
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
      label: 'Identity',
      description: 'Connect identity providers for tenant discovery and contact synchronization.',
      icon: Shield,
      integrations: [
        ...(isEntraUiEnabled ? [{
          id: 'entra',
          name: 'Microsoft Entra',
          description: 'Discover managed Microsoft tenants and sync users to contacts',
          component: canUseEntraSync
            ? () => <EntraIntegrationSettings canUseCipp={canUseCipp} />
            : () => (
                <FeatureUpgradeNotice
                  featureName="Entra Sync"
                  requiredTier="premium"
                  description="Discover managed Microsoft Entra tenants and sync users to contacts. Upgrade to Premium to unlock this feature."
                />
              ),
          isEE: true,
        }] : []),
      ],
    },
    {
      id: 'payments',
      label: 'Payments',
      description: 'Accept online payments for invoices',
      icon: CreditCard,
      integrations: [
        ...(isEEAvailable ? [{
          id: 'stripe',
          name: 'Stripe',
          description: 'Accept credit card payments for invoices via Stripe',
          component: StripeConnectionSettings,
          isEE: true,
        }] : []),
      ],
    },
  ], [isEEAvailable, isEntraUiEnabled]);

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
                {category.label} Integrations
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
            No integrations available in this category.
            {category.id === 'rmm' && !isEEAvailable && (
              <p className="mt-2 text-sm">
                RMM integrations are available in the Enterprise edition.
              </p>
            )}
          </div>
        )}
      </div>
    ),
  }));

  return (
    <div className="space-y-6">
      {/* Beta notice */}
      <Alert variant="info">
        <AlertDescription>
          Some integrations are still in development. Please work in a sandbox environment when evaluating,
          and share your feedback to help us improve.
        </AlertDescription>
      </Alert>

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
