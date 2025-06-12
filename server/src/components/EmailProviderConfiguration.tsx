/**
 * Email Provider Configuration Component
 * Main interface for managing email provider configurations (Microsoft and Gmail)
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Alert, AlertDescription } from './ui/Alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/Tabs';
import { Plus, Settings, Trash2, CheckCircle, Clock } from 'lucide-react';
import { MicrosoftProviderForm } from './MicrosoftProviderForm';
import { GmailProviderForm } from './GmailProviderForm';
import { EmailProviderList } from './EmailProviderList';

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
  vendorConfig: any;
  createdAt: string;
  updatedAt: string;
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
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<EmailProvider | null>(null);

  // Load existing providers on component mount
  useEffect(() => {
    loadProviders();
  }, [tenant]);

  const loadProviders = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(`/api/email/providers?tenant=${tenant}`);
      if (!response.ok) {
        throw new Error('Failed to load email providers');
      }
      
      const data = await response.json();
      setProviders(data.providers || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleProviderAdded = (provider: EmailProvider) => {
    setProviders(prev => [...prev, provider]);
    setShowAddForm(false);
    onProviderAdded?.(provider);
  };

  const handleProviderUpdated = (provider: EmailProvider) => {
    setProviders(prev => prev.map(p => p.id === provider.id ? provider : p));
    setSelectedProvider(null);
    onProviderUpdated?.(provider);
  };

  const handleProviderDeleted = async (providerId: string) => {
    try {
      const response = await fetch(`/api/email/providers/${providerId}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete provider');
      }
      
      setProviders(prev => prev.filter(p => p.id !== providerId));
      onProviderDeleted?.(providerId);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleTestConnection = async (provider: EmailProvider) => {
    try {
      setError(null);
      
      const response = await fetch(`/api/email/providers/${provider.id}/test`, {
        method: 'POST'
      });
      
      if (!response.ok) {
        throw new Error('Connection test failed');
      }
      
      const result = await response.json();
      
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
          onClick={() => setShowAddForm(true)}
          disabled={showAddForm}
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

      {/* Add Provider Form */}
      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle>Add New Email Provider</CardTitle>
            <CardDescription>
              Configure a new email provider to start receiving inbound emails
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value="microsoft" onValueChange={() => {}} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="microsoft">Microsoft 365</TabsTrigger>
                <TabsTrigger value="gmail">Gmail</TabsTrigger>
              </TabsList>
              
              <TabsContent value="microsoft" className="space-y-4">
                <MicrosoftProviderForm
                  tenant={tenant}
                  onSuccess={handleProviderAdded}
                  onCancel={() => setShowAddForm(false)}
                />
              </TabsContent>
              
              <TabsContent value="gmail" className="space-y-4">
                <GmailProviderForm
                  tenant={tenant}
                  onSuccess={handleProviderAdded}
                  onCancel={() => setShowAddForm(false)}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* Provider List */}
      <EmailProviderList
        providers={providers}
        onEdit={setSelectedProvider}
        onDelete={handleProviderDeleted}
        onTestConnection={handleTestConnection}
        onRefresh={loadProviders}
      />

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
                onCancel={() => setSelectedProvider(null)}
              />
            ) : (
              <GmailProviderForm
                tenant={tenant}
                provider={selectedProvider}
                onSuccess={handleProviderUpdated}
                onCancel={() => setSelectedProvider(null)}
              />
            )}
          </CardContent>
        </Card>
      )}

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
              1. Create a project in Google Cloud Console<br/>
              2. Enable Gmail API and create OAuth2 credentials<br/>
              3. Set up Pub/Sub topic for push notifications<br/>
              4. Configure the OAuth consent screen and add test users
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}