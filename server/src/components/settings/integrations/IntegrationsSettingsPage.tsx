'use client';

/**
 * Integrations Settings Page
 *
 * Category-based organization of integrations for better navigation
 * as the number of supported integrations grows.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/Card';
import { Alert, AlertDescription } from '../../ui/Alert';
import CustomTabs, { TabContent } from '../../ui/CustomTabs';
import {
  Building2,
  Monitor,
  Mail,
  Calendar,
  ChevronRight,
} from 'lucide-react';
import QboIntegrationSettings from './QboIntegrationSettings';
import XeroIntegrationSettings from './XeroIntegrationSettings';
import { EmailProviderConfiguration } from '../../EmailProviderConfiguration';
import { CalendarIntegrationsSettings } from '../../calendar/CalendarIntegrationsSettings';
import dynamic from 'next/dynamic';
import LoadingIndicator from '../../ui/LoadingIndicator';

// Dynamic import for NinjaOne (EE feature)
const NinjaOneIntegrationSettings = dynamic(
  () => import('@ee/components/settings/integrations/NinjaOneIntegrationSettings'),
  {
    loading: () => (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center">
            <LoadingIndicator 
              layout="stacked" 
              text="Loading NinjaOne integration settings..."
              spinnerProps={{ size: 'md' }}
            />
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

const IntegrationsSettingsPage: React.FC = () => {
  const isEEAvailable = process.env.NEXT_PUBLIC_EDITION === 'enterprise';
  const searchParams = useSearchParams();
  const categoryParam = searchParams?.get('category');
  
  // Initialize selected category from URL param or default to 'accounting'
  const [selectedCategory, setSelectedCategory] = useState<string>(
    categoryParam && ['accounting', 'rmm', 'communication', 'calendar'].includes(categoryParam)
      ? categoryParam
      : 'accounting'
  );
  
  // Update selected category when URL param changes
  useEffect(() => {
    if (categoryParam && ['accounting', 'rmm', 'communication', 'calendar'].includes(categoryParam)) {
      setSelectedCategory(categoryParam);
    }
  }, [categoryParam]);

  // Define integration categories
  const categories: IntegrationCategory[] = useMemo(() => [
    {
      id: 'accounting',
      label: 'Accounting',
      description: 'Connect accounting software to sync invoices and payments',
      icon: Building2,
      integrations: [
        {
          id: 'qbo',
          name: 'QuickBooks Online',
          description: 'Sync invoices and payments with QuickBooks Online',
          component: QboIntegrationSettings,
        },
        {
          id: 'xero',
          name: 'Xero',
          description: 'Sync invoices and payments with Xero',
          component: XeroIntegrationSettings,
        },
      ],
    },
    {
      id: 'rmm',
      label: 'RMM',
      description: 'Connect remote monitoring and management tools',
      icon: Monitor,
      integrations: [
        ...(isEEAvailable ? [{
          id: 'ninjaone',
          name: 'NinjaOne',
          description: 'Sync devices, receive alerts, and enable remote access',
          component: NinjaOneIntegrationSettings,
          isEE: true,
        }] : []),
      ],
    },
    {
      id: 'communication',
      label: 'Communication',
      description: 'Connect email and calendar services',
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
          id: 'calendar',
          name: 'Calendar',
          description: 'Sync schedule entries with Google or Microsoft calendars',
          component: () => (
            <Card>
              <CardHeader>
                <CardTitle>Calendar Integrations</CardTitle>
                <CardDescription>
                  Connect Google Calendar or Microsoft Outlook Calendar to sync schedule entries
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CalendarIntegrationsSettings />
              </CardContent>
            </Card>
          ),
        },
      ],
    },
  ], [isEEAvailable]);

  // Filter out empty categories
  const visibleCategories = categories.filter(cat => cat.integrations.length > 0);

  // Get current category
  const currentCategory = visibleCategories.find(cat => cat.id === selectedCategory) || visibleCategories[0];

  // Build tab content
  const tabContent: TabContent[] = visibleCategories.map(category => ({
    label: category.label,
    content: (
      <div className="space-y-6">
        {/* Category header */}
        <div className="flex items-start gap-3 pb-4 border-b">
          <category.icon className="h-6 w-6 text-primary mt-0.5" />
          <div>
            <h3 className="text-lg font-semibold">{category.label} Integrations</h3>
            <p className="text-sm text-muted-foreground">{category.description}</p>
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
        defaultTab={currentCategory?.label || 'Accounting'}
        onTabChange={(tabLabel) => {
          const category = visibleCategories.find(cat => cat.label === tabLabel);
          if (category) {
            setSelectedCategory(category.id);
          }
        }}
      />
    </div>
  );
};

export default IntegrationsSettingsPage;
