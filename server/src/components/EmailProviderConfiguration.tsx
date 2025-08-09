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
import { MicrosoftProviderForm } from '@ee/components/MicrosoftProviderForm';
import { EmailProviderList } from './EmailProviderList';
import { GmailProviderForm } from '@ee/components/GmailProviderForm';
import { EmailProviderSelector } from './EmailProviderSelector';
import { InboundTicketDefaultsManager } from './admin/InboundTicketDefaultsManager';
import { 
  getEmailProviders, 
  deleteEmailProvider, 
  testEmailProviderConnection 
} from '../lib/actions/email-actions/emailProviderActions';

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
  tenant: string;
  onProviderAdded?: (provider: EmailProvider) => void;
  onProviderUpdated?: (provider: EmailProvider) => void;
  onProviderDeleted?: (providerId: string) => void;
}

export function EmailProviderConfiguration({
  tenant,
  onProviderAdded,
  onProviderUpdated,
  onProviderDeleted
}: EmailProviderConfigurationProps) {
  const [providers, setProviders] = useState<EmailProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showProviderSelector, setShowProviderSelector] = useState(false);
  const [isSetupMode, setIsSetupMode] = useState(false);
  const [setupProviderType, setSetupProviderType] = useState<'microsoft' | 'google' | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<EmailProvider | null>(null);
  const [showDefaultsManager, setShowDefaultsManager] = useState(false);

  // Load existing providers on component mount
  useEffect(() => {
    loadProviders();
  }, [tenant]);

  // Update UI state based on providers
  useEffect(() => {
    if (!loading) {
      setShowProviderSelector(providers.length === 0 && !isSetupMode);
    }
  }, [providers, loading, isSetupMode]);

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

  const handleProviderAdded = (provider: EmailProvider) => {
    setProviders(prev => [...prev, provider]);
    setIsSetupMode(false);
    setSetupProviderType(null);
    setShowProviderSelector(false);
    onProviderAdded?.(provider);
  };

  const handleProviderUpdated = (provider: EmailProvider) => {
    setProviders(prev => prev.map(p => p.id === provider.id ? provider : p));
    setSelectedProvider(null);
    onProviderUpdated?.(provider);
  };

  const handleProviderDeleted = async (providerId: string) => {
    try {
      await deleteEmailProvider(providerId);
      
      setProviders(prev => prev.filter(p => p.id !== providerId));
      
      // After deletion, show provider selector if no providers remain
      const remainingProviders = providers.filter(p => p.id !== providerId);
      if (remainingProviders.length === 0) {
        setShowProviderSelector(true);
      }
      
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

  const handleProviderSelected = (providerType: 'google' | 'microsoft') => {
    setSetupProviderType(providerType);
    setIsSetupMode(true);
    setShowProviderSelector(false);
  };

  const handleSetupCancel = () => {
    setIsSetupMode(false);
    setSetupProviderType(null);
    // Return to selector if no providers exist, otherwise to list
    if (providers.length === 0) {
      setShowProviderSelector(true);
    }
  };

  const handleEditCancel = () => {
    setSelectedProvider(null);
    // Always return to provider list when editing
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

  // Show provider selector when no providers exist and not in setup mode
  if (showProviderSelector) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="text-center">
          <h2 className="text-2xl font-bold tracking-tight">Email Provider Configuration</h2>
          <p className="text-muted-foreground mt-2">
            Set up inbound email processing to automatically create tickets from emails
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <EmailProviderSelector onProviderSelected={handleProviderSelected} />
      </div>
    );
  }

  // Show setup form when in setup mode
  if (isSetupMode && setupProviderType) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="text-center">
          <h2 className="text-2xl font-bold tracking-tight">
            Set up {setupProviderType === 'google' ? 'Gmail' : 'Microsoft 365'} Provider
          </h2>
          <p className="text-muted-foreground mt-2">
            Configure your {setupProviderType === 'google' ? 'Gmail' : 'Microsoft 365'} account for inbound email processing
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardContent className="pt-6">
            {setupProviderType === 'microsoft' ? (
              <MicrosoftProviderForm
                tenant={tenant}
                onSuccess={handleProviderAdded}
                onCancel={handleSetupCancel}
              />
            ) : (
              <GmailProviderForm
                tenant={tenant}
                onSuccess={handleProviderAdded}
                onCancel={handleSetupCancel}
              />
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Email Provider Configuration</h2>
          <p className="text-muted-foreground">
            Configure email providers to receive and process inbound emails as tickets
          </p>
        </div>
        <Button 
          id="add-provider-btn"
          onClick={() => setShowProviderSelector(true)}
          disabled={providers.length > 0}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Email Provider
        </Button>
      </div>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Ticket Defaults Management */}
      {showDefaultsManager && (
        <Card>
          <CardHeader>
            <CardTitle>Manage Ticket Defaults</CardTitle>
            <CardDescription>
              Configure default values for tickets created from email processing
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InboundTicketDefaultsManager 
              onDefaultsChange={() => {
                // Optionally refresh providers to show updated defaults
                loadProviders();
              }}
            />
            <div className="flex justify-end mt-6">
              <Button 
                id="close-defaults-btn"
                variant="outline" 
                onClick={() => setShowDefaultsManager(false)}
              >
                Close
              </Button>
            </div>
          </CardContent>
        </Card>
      )}


      {/* Provider List - only show when providers exist */}
      {providers.length > 0 && (
        <EmailProviderList
          providers={providers}
          onEdit={setSelectedProvider}
          onDelete={handleProviderDeleted}
          onTestConnection={handleTestConnection}
          onRefresh={loadProviders}
          onRefreshWatchSubscription={handleRefreshWatchSubscription}
        />
      )}

      {/* Edit Provider Form */}
      {selectedProvider && (
        <Card>
          <CardHeader>
            <CardTitle>Edit Email Provider</CardTitle>
            <CardDescription>
              Update configuration for {selectedProvider.providerName}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selectedProvider.providerType === 'microsoft' ? (
              <MicrosoftProviderForm
                tenant={tenant}
                provider={selectedProvider}
                onSuccess={handleProviderUpdated}
                onCancel={handleEditCancel}
              />
            ) : (
              <GmailProviderForm
                tenant={tenant}
                provider={selectedProvider}
                onSuccess={handleProviderUpdated}
                onCancel={handleEditCancel}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Management Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Management</CardTitle>
          <CardDescription>
            Additional configuration options for email processing
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button 
            id="manage-defaults-btn"
            variant="outline"
            onClick={() => setShowDefaultsManager(true)}
            disabled={showDefaultsManager}
          >
            <Settings className="h-4 w-4 mr-2" />
            Manage Ticket Defaults
          </Button>
          <p className="text-sm text-muted-foreground mt-2">
            Configure default values that will be applied to tickets created from email processing
          </p>
        </CardContent>
      </Card>

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
}
