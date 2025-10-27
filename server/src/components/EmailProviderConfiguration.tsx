/**
 * Email Provider Configuration Component
 * Main interface for managing email provider configurations (Microsoft and Gmail)
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Alert, AlertDescription } from './ui/Alert';
import { Plus, Settings, Trash2, CheckCircle, Clock } from 'lucide-react';
import { MicrosoftProviderForm, GmailProviderForm } from '@product/email-providers/entry';
import { EmailProviderList } from './EmailProviderList';
import { ProviderSetupWizardDialog } from './ProviderSetupWizardDialog';
import { InboundTicketDefaultsManager } from './admin/InboundTicketDefaultsManager';
import { DrawerProvider, useDrawer } from 'server/src/context/DrawerContext';
import {
  getEmailProviders,
  deleteEmailProvider,
  testEmailProviderConnection
} from '@product/actions/email-actions/emailProviderActions';
import { getCurrentUser } from '@product/actions/user-actions/userActions';

export interface EmailProvider {
  id: string;
  tenant: string;
  providerType: 'microsoft' | 'google';
  providerName: string;
  mailbox: string;
  isActive: boolean;
  status: 'connected' | 'disconnected' | 'error' | 'configuring';
  lastSyncAt?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  inboundTicketDefaultsId?: string;
  // Vendor-specific config will be loaded separately
  microsoftConfig?: MicrosoftEmailProviderConfig;
  googleConfig?: GoogleEmailProviderConfig;
}

export interface MicrosoftEmailProviderConfig {
  email_provider_id: string;
  tenant: string;
  client_id: string | null;
  client_secret: string | null;
  tenant_id: string;
  redirect_uri: string;
  auto_process_emails: boolean;
  max_emails_per_sync: number;
  folder_filters: string[];
  access_token?: string;
  refresh_token?: string;
  token_expires_at?: string;
  created_at: string;
  updated_at: string;
}

export interface GoogleEmailProviderConfig {
  email_provider_id: string;
  tenant: string;
  client_id: string | null;
  client_secret: string | null;
  project_id: string;
  redirect_uri: string;
  auto_process_emails: boolean;
  max_emails_per_sync: number;
  label_filters: string[];
  access_token?: string;
  refresh_token?: string;
  token_expires_at?: string;
  history_id?: string;
  watch_expiration?: string;
  pubsub_initialised_at?: string;
  created_at: string;
  updated_at: string;
}

export interface EmailProviderConfigurationProps {
  onProviderAdded?: (provider: EmailProvider) => void;
  onProviderUpdated?: (provider: EmailProvider) => void;
  onProviderDeleted?: (providerId: string) => void;
}

function EmailProviderConfigurationContent({
  onProviderAdded,
  onProviderUpdated,
  onProviderDeleted
}: EmailProviderConfigurationProps) {
  const [providers, setProviders] = useState<EmailProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [showDefaultsManager, setShowDefaultsManager] = useState(false);
  const [tenant, setTenant] = useState<string>('');
  const [activeSection, setActiveSection] = useState<'providers' | 'defaults'>('providers');
  const { openDrawer, closeDrawer } = useDrawer();

  // Load existing providers on component mount
  useEffect(() => {
    loadProviders();
  }, []);

  // Get tenant on mount
  useEffect(() => {
    const fetchTenant = async () => {
      try {
        const user = await getCurrentUser();
        if (user?.tenant) {
          setTenant(user.tenant);
        }
      } catch (error) {
        console.error('Failed to get tenant:', error);
      }
    };
    fetchTenant();
  }, []);

  // Listen for requests to open defaults tab from child forms
  useEffect(() => {
    const openDefaults = () => setActiveSection('defaults');
    window.addEventListener('open-defaults-tab', openDefaults);
    return () => window.removeEventListener('open-defaults-tab', openDefaults);
  }, []);

  // Wizard handles add flow; no inline auto-open

  const loadProviders = async () => {
    try {
      setLoading(true);
      setError(null);

      const data = await getEmailProviders();
      setProviders(data.providers || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Add handled via wizard; we refresh list on completion

  const handleProviderUpdated = (provider: EmailProvider) => {
    setProviders(prev => prev.map(p => p.id === provider.id ? provider : p));
    onProviderUpdated?.(provider);
  };

  const handleProviderDeleted = async (providerId: string) => {
    try {
      await deleteEmailProvider(providerId);

      setProviders(prev => prev.filter(p => p.id !== providerId));

      // No inline selector; wizard handles starting setup

      onProviderDeleted?.(providerId);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleTestConnection = async (provider: EmailProvider) => {
    try {
      setError(null);

      const result = await testEmailProviderConnection(provider.id);

      if (result.success) {
        // Update provider status
        const updatedProvider = { ...provider, status: 'connected' as const };
        handleProviderUpdated(updatedProvider);
      } else {
        setError(result.error || 'Connection test failed');
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRefreshWatchSubscription = async (provider: EmailProvider) => {
    try {
      setError(null);

      const response = await fetch('/api/email/refresh-watch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ providerId: provider.id }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        // Refresh the providers list to show updated status
        await loadProviders();
      } else {
        setError(result.error || 'Failed to refresh watch subscription');
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Inline add/setup flow removed in favor of wizard

  const handleEditCancel = () => {
    closeDrawer();
  };

  const openEditDrawer = (provider: EmailProvider) => {
    openDrawer(
      (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Edit Email Provider</h2>
            <p className="text-sm text-muted-foreground">Update configuration for {provider.providerName}</p>
          </div>
          {provider.providerType === 'microsoft' ? (
            <MicrosoftProviderForm
              tenant={tenant}
              provider={provider}
              onSuccess={(p) => { handleProviderUpdated(p); closeDrawer(); }}
              onCancel={handleEditCancel}
            />
          ) : (
            <GmailProviderForm
              tenant={tenant}
              provider={provider}
              onSuccess={(p) => { handleProviderUpdated(p); closeDrawer(); }}
              onCancel={handleEditCancel}
            />
          )}
        </div>
      )
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="flex items-center space-x-2">
          <Clock className="h-4 w-4 animate-spin" />
          <span>Loading email providers...</span>
        </div>
      </div>
    );
  }

  // Build right-hand content for Providers section
  const renderProvidersContent = () => {
    // Standard providers view with wizard-based add flow
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Email Provider Configuration</h2>
            <p className="text-muted-foreground">
              Configure email providers to receive and process inbound emails as tickets
            </p>
          </div>
          <Button
            id="add-provider-btn"
            onClick={() => setWizardOpen(true)}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Email Provider
          </Button>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <EmailProviderList
          providers={providers}
          onEdit={openEditDrawer}
          onDelete={handleProviderDeleted}
          onTestConnection={handleTestConnection}
          onRefresh={loadProviders}
          onRefreshWatchSubscription={handleRefreshWatchSubscription}
          onAddClick={() => setWizardOpen(true)}
        />


        {/* Help Information */}
        <Card>
          <CardHeader>
            <CardTitle>Setup Instructions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="font-medium mb-2">Microsoft 365 Setup</h4>
              <p className="text-sm text-muted-foreground">
                1. Register an application in Azure AD<br/>
                2. Configure API permissions for Mail.Read<br/>
                3. Set up the redirect URL in your app registration<br/>
                4. Use the Client ID and Client Secret in the form above
              </p>
            </div>
            <div>
              <h4 className="font-medium mb-2">Gmail Setup</h4>
              <p className="text-sm text-muted-foreground">
                {process.env.NEXT_PUBLIC_EDITION === 'enterprise' ? (
                  <>
                    1. Enter your Gmail address and provider name<br/>
                    2. Click "Connect Gmail" to authorize access<br/>
                    3. Configure email processing preferences<br/>
                    4. Save to complete setup
                  </>
                ) : (
                  <>
                    1. Create a project in Google Cloud Console<br/>
                    2. Enable Gmail API and create OAuth2 credentials<br/>
                    3. Set up Pub/Sub topic for push notifications<br/>
                    4. Configure the OAuth consent screen and add test users
                  </>
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  // Vertical layout wrapper with left nav
  return (
    <div className="flex gap-6">
      {/* Vertical tabs area with subtle separator bar and no card */}
      <div className="w-56 shrink-0 pr-4 mr-4 border-r border-gray-200">
        <nav className="flex flex-col gap-1">
          <Button
            id="nav-providers"
            variant="ghost"
            className={`justify-start w-full px-2 py-2 rounded-md ${
              activeSection === 'providers'
                ? 'text-purple-700 font-semibold underline decoration-purple-600 decoration-2 underline-offset-4 bg-purple-50'
                : 'text-gray-700 hover:text-gray-900 hover:bg-gray-50'
            }`}
            onClick={() => setActiveSection('providers')}
          >
            Providers
          </Button>
          <Button
            id="nav-defaults"
            variant="ghost"
            className={`justify-start w-full px-2 py-2 rounded-md ${
              activeSection === 'defaults'
                ? 'text-purple-700 font-semibold underline decoration-purple-600 decoration-2 underline-offset-4 bg-purple-50'
                : 'text-gray-700 hover:text-gray-900 hover:bg-gray-50'
            }`}
            onClick={() => setActiveSection('defaults')}
          >
            Defaults
          </Button>
        </nav>
      </div>
      <div className="flex-1 min-w-0">
        {activeSection === 'providers' ? (
          <>
            {renderProvidersContent()}
            <ProviderSetupWizardDialog
              isOpen={wizardOpen}
              onClose={() => setWizardOpen(false)}
              onComplete={async (provider) => { onProviderAdded?.(provider); setWizardOpen(false); await loadProviders(); }}
              tenant={tenant}
            />
          </>
        ) : (
          <div className="space-y-4">
            <InboundTicketDefaultsManager onDefaultsChange={() => {
              // Refresh providers and notify forms to reload defaults lists
              loadProviders();
              window.dispatchEvent(new CustomEvent('inbound-defaults-updated'));
            }} />
          </div>
        )}
      </div>
    </div>
  );
}

export function EmailProviderConfiguration(props: EmailProviderConfigurationProps) {
  return (
    <DrawerProvider>
      <EmailProviderConfigurationContent {...props} />
    </DrawerProvider>
  );
}
