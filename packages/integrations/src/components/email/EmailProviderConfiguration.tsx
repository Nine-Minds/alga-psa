/**
 * Email Provider Configuration Component
 * Main interface for managing email provider configurations (Microsoft and Gmail)
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Plus, Settings, Trash2, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { GmailProviderForm } from './GmailProviderForm';
import { ImapProviderForm } from './ImapProviderForm';
import { MicrosoftProviderForm } from './MicrosoftProviderForm';
import { EmailProviderList } from './EmailProviderList';
import { ProviderSetupWizardDialog } from './ProviderSetupWizardDialog';
import { InboundTicketDefaultsManager } from './admin/InboundTicketDefaultsManager';
import { Microsoft365DiagnosticsDialog } from './admin/Microsoft365DiagnosticsDialog';
import { DrawerProvider, useDrawer } from '@alga-psa/ui';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import {
  getEmailProviders,
  deleteEmailProvider,
  testEmailProviderConnection,
  resyncImapProvider,
  retryMicrosoftSubscriptionRenewal
} from '../../actions/email-actions/emailProviderActions';
import { getCurrentUser } from '@alga-psa/users/actions';
import {
  EmailProvider,
  GoogleEmailProviderConfig,
  ImapEmailProviderConfig,
  MicrosoftEmailProviderConfig,
} from './types';

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
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnosticsProvider, setDiagnosticsProvider] = useState<EmailProvider | null>(null);
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

      const toastId = toast.loading(`Testing connection for ${provider.providerName}...`);
      const result = await testEmailProviderConnection(provider.id);

      if (result.success) {
        // Update provider status
        const updatedProvider = { ...provider, status: 'connected' as const };
        handleProviderUpdated(updatedProvider);
        toast.success(`Connected to ${provider.providerName}.`, { id: toastId });
      } else {
        const message = result.error || 'Connection test failed';
        setError(message);
        toast.error(message, { id: toastId });
      }
    } catch (err: any) {
      setError(err.message);
      toast.error(err.message);
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

  const handleRetryRenewal = async (provider: EmailProvider) => {
    try {
      setError(null);
      const result = await retryMicrosoftSubscriptionRenewal(provider.id);
      if (result.success) {
        await loadProviders();
      } else {
        setError(result.message || 'Renewal failed');
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleReconnectOAuth = async (provider: EmailProvider) => {
    try {
      setError(null);
      const response = await fetch('/api/email/oauth/imap/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: provider.id }),
      });
      const result = await response.json();
      if (!response.ok || !result.authUrl) {
        throw new Error(result.error || 'Failed to initiate IMAP OAuth');
      }
      window.open(result.authUrl, '_blank', 'width=600,height=700');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleResyncProvider = async (provider: EmailProvider) => {
    try {
      setError(null);
      const toastId = toast.loading(`Resyncing ${provider.providerName}...`);
      const result = await resyncImapProvider(provider.id);
      if (!result.success) {
        const message = result.error || 'Failed to resync IMAP provider';
        toast.error(message, { id: toastId });
        throw new Error(message);
      }
      toast.success(`Resync started for ${provider.providerName}.`, { id: toastId });
      await loadProviders();
    } catch (err: any) {
      setError(err.message);
      toast.error(err.message);
    }
  };

  const handleRunDiagnostics = (provider: EmailProvider) => {
    setDiagnosticsProvider(provider);
    setDiagnosticsOpen(true);
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
          {provider.providerType === 'microsoft' && (
            <MicrosoftProviderForm
              tenant={tenant}
              provider={provider}
              onSuccess={(p) => { handleProviderUpdated(p); closeDrawer(); }}
              onCancel={handleEditCancel}
            />
          )}
          {provider.providerType === 'google' && (
            <GmailProviderForm
              tenant={tenant}
              provider={provider}
              onSuccess={(p) => { handleProviderUpdated(p); closeDrawer(); }}
              onCancel={handleEditCancel}
            />
          )}
          {provider.providerType === 'imap' && (
            <ImapProviderForm
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
        <LoadingIndicator 
          layout="stacked" 
          text="Loading email providers..."
          spinnerProps={{ size: 'md' }}
        />
      </div>
    );
  }

  // Build right-hand content for Providers section
  const renderProvidersContent = () => {
    const providerCounts = providers.reduce(
      (acc, provider) => {
        acc[provider.providerType] = (acc[provider.providerType] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    // Standard providers view with wizard-based add flow
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Email Provider Configuration</h2>
            <p className="text-muted-foreground">
              Configure Gmail, Microsoft 365, or IMAP providers to receive and process inbound emails as tickets
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Gmail: {providerCounts.google || 0} · Microsoft: {providerCounts.microsoft || 0} · IMAP: {providerCounts.imap || 0}
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
          onRetryRenewal={handleRetryRenewal}
          onReconnectOAuth={handleReconnectOAuth}
          onResyncProvider={handleResyncProvider}
          onRunDiagnostics={handleRunDiagnostics}
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
            <Microsoft365DiagnosticsDialog
              isOpen={diagnosticsOpen}
              onClose={() => setDiagnosticsOpen(false)}
              provider={diagnosticsProvider}
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
