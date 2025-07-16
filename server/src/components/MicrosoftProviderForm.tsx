/**
 * Microsoft Provider Configuration Form
 * Form for setting up Microsoft 365/Exchange Online email integration
 */

'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Label } from './ui/Label';
import { Switch } from './ui/Switch';
import { Alert, AlertDescription } from './ui/Alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/Card';
import { ExternalLink, Eye, EyeOff, CheckCircle } from 'lucide-react';
import type { EmailProvider } from './EmailProviderConfiguration';
import { createEmailProvider, updateEmailProvider } from '../lib/actions/email-actions/emailProviderActions';
import { getInboundTicketDefaults } from '../lib/actions/email-actions/inboundTicketDefaultsActions';
import CustomSelect from './ui/CustomSelect';
import type { InboundTicketDefaults } from '../types/email.types';

const microsoftProviderSchema = z.object({
  providerName: z.string().min(1, 'Provider name is required'),
  mailbox: z.string().email('Valid email address is required'),
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().min(1, 'Client Secret is required'),
  tenantId: z.string().optional(),
  redirectUri: z.string().url('Valid redirect URI is required'),
  isActive: z.boolean(),
  autoProcessEmails: z.boolean(),
  folderFilters: z.string().optional(),
  maxEmailsPerSync: z.number().min(1).max(1000),
  inboundTicketDefaultsId: z.string().optional()
});

type MicrosoftProviderFormData = z.infer<typeof microsoftProviderSchema>;

interface MicrosoftProviderFormProps {
  tenant: string;
  provider?: EmailProvider;
  onSuccess: (provider: EmailProvider) => void;
  onCancel: () => void;
}

export function MicrosoftProviderForm({ 
  tenant, 
  provider, 
  onSuccess, 
  onCancel 
}: MicrosoftProviderFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'authorizing' | 'success' | 'error'>('idle');
  const [oauthData, setOauthData] = useState<any>(null);
  const [ticketDefaults, setTicketDefaults] = useState<InboundTicketDefaults[]>([]);
  const [loadingDefaults, setLoadingDefaults] = useState(true);

  const isEditing = !!provider;

  // Load ticket defaults on mount
  React.useEffect(() => {
    loadTicketDefaults();
  }, []);

  const loadTicketDefaults = async () => {
    try {
      setLoadingDefaults(true);
      const data = await getInboundTicketDefaults();
      setTicketDefaults(data.defaults || []);
    } catch (err: any) {
      console.error('Failed to load ticket defaults:', err);
    } finally {
      setLoadingDefaults(false);
    }
  };

  const form = useForm<MicrosoftProviderFormData>({
    resolver: zodResolver(microsoftProviderSchema) as any,
    defaultValues: provider && provider.microsoftConfig ? {
      providerName: provider.providerName,
      mailbox: provider.mailbox,
      clientId: provider.microsoftConfig.client_id,
      clientSecret: provider.microsoftConfig.client_secret,
      tenantId: provider.microsoftConfig.tenant_id,
      redirectUri: provider.microsoftConfig.redirect_uri,
      isActive: provider.isActive,
      autoProcessEmails: provider.microsoftConfig.auto_process_emails ?? true,
      folderFilters: provider.microsoftConfig.folder_filters?.join(', '),
      maxEmailsPerSync: provider.microsoftConfig.max_emails_per_sync ?? 50,
      inboundTicketDefaultsId: provider.inboundTicketDefaultsId
    } : {
      redirectUri: `${window.location.origin}/api/auth/microsoft/callback`,
      isActive: true,
      autoProcessEmails: true,
      maxEmailsPerSync: 50,
      inboundTicketDefaultsId: ''
    }
  });

  const onSubmit = async (data: MicrosoftProviderFormData) => {
    try {
      setLoading(true);
      setError(null);

      const payload = {
        tenant,
        providerType: 'microsoft',
        providerName: data.providerName,
        mailbox: data.mailbox,
        isActive: data.isActive,
        microsoftConfig: {
          client_id: data.clientId,
          client_secret: data.clientSecret,
          tenant_id: data.tenantId || '',
          redirect_uri: data.redirectUri,
          auto_process_emails: data.autoProcessEmails,
          folder_filters: data.folderFilters ? data.folderFilters.split(',').map(f => f.trim()) : ['Inbox'],
          max_emails_per_sync: data.maxEmailsPerSync
        },
        inboundTicketDefaultsId: data.inboundTicketDefaultsId || undefined
      };

      const result = isEditing 
        ? await updateEmailProvider(provider.id, payload)
        : await createEmailProvider(payload);

      onSuccess(result.provider);

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthAuthorization = async () => {
    try {
      setOauthStatus('authorizing');
      setError(null);

      const formData = form.getValues();

      // Get OAuth URL from API
      const response = await fetch('/api/email/oauth/initiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'microsoft',
          redirectUri: formData.redirectUri,
          providerId: provider?.id
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to initiate OAuth');
      }

      const { authUrl } = await response.json();

      // Open OAuth popup
      const popup = window.open(
        authUrl,
        'microsoft-oauth',
        'width=600,height=700,scrollbars=yes,resizable=yes'
      );

      if (!popup) {
        throw new Error('Failed to open OAuth popup. Please allow popups for this site.');
      }

      // Monitor popup for completion
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          if (oauthStatus === 'authorizing') {
            setOauthStatus('idle');
          }
        }
      }, 1000);

      // Listen for OAuth callback
      const messageHandler = (event: MessageEvent) => {
        // Validate message is from our callback
        if (event.data.type === 'oauth-callback' && event.data.provider === 'microsoft') {
          clearInterval(checkClosed);
          popup?.close();
          
          if (event.data.success) {
            // Store the authorization code and tokens in OAuth data (not form)
            // These are temporary OAuth fields, not part of the provider configuration
            
            // Store tokens for the submit
            setOauthData(event.data.data);
            
            setOauthStatus('success');
          } else {
            setOauthStatus('error');
            setError(event.data.errorDescription || event.data.error || 'Authorization failed');
          }
          
          window.removeEventListener('message', messageHandler);
        }
      };

      window.addEventListener('message', messageHandler);

    } catch (err: any) {
      setOauthStatus('error');
      setError(err.message);
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit as any)} className="space-y-6">
      {/* Basic Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Basic Configuration</CardTitle>
          <CardDescription>
            Basic settings for your Microsoft 365 email provider
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="providerName">Provider Name</Label>
              <Input
                id="providerName"
                {...form.register('providerName')}
                placeholder="e.g., Support Email"
              />
              {form.formState.errors.providerName && (
                <p className="text-sm text-red-500">{form.formState.errors.providerName.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="mailbox">Email Address</Label>
              <Input
                id="mailbox"
                type="email"
                {...form.register('mailbox')}
                placeholder="support@company.com"
              />
              {form.formState.errors.mailbox && (
                <p className="text-sm text-red-500">{form.formState.errors.mailbox.message}</p>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="isActive"
              checked={form.watch('isActive')}
              onCheckedChange={(checked: boolean) => form.setValue('isActive', checked)}
            />
            <Label htmlFor="isActive">Enable this provider</Label>
          </div>
        </CardContent>
      </Card>

      {/* Microsoft OAuth Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Microsoft OAuth Configuration</CardTitle>
          <CardDescription>
            Configure OAuth settings from your Azure AD app registration
            <Button 
              id="azure-portal-link"
              type="button" 
              variant="link" 
              className="p-0 h-auto ml-2"
              onClick={() => window.open('https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade', '_blank')}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              Azure Portal
            </Button>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="clientId">Client ID</Label>
              <Input
                id="clientId"
                {...form.register('clientId')}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
              {form.formState.errors.clientId && (
                <p className="text-sm text-red-500">{form.formState.errors.clientId.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="tenantId">Tenant ID (Optional)</Label>
              <Input
                id="tenantId"
                {...form.register('tenantId')}
                placeholder="common (or specific tenant ID)"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="clientSecret">Client Secret</Label>
            <div className="relative">
              <Input
                id="clientSecret"
                type={showClientSecret ? 'text' : 'password'}
                {...form.register('clientSecret')}
                placeholder="Enter client secret"
              />
              <Button
                id="toggle-secret-visibility"
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3"
                onClick={() => setShowClientSecret(!showClientSecret)}
              >
                {showClientSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            {form.formState.errors.clientSecret && (
              <p className="text-sm text-red-500">{form.formState.errors.clientSecret.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="redirectUri">Redirect URI</Label>
            <Input
              id="redirectUri"
              {...form.register('redirectUri')}
              placeholder="https://yourapp.com/api/auth/microsoft/callback"
            />
            {form.formState.errors.redirectUri && (
              <p className="text-sm text-red-500">{form.formState.errors.redirectUri.message}</p>
            )}
          </div>

          {/* OAuth Authorization */}
          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">OAuth Authorization</h4>
                <p className="text-sm text-muted-foreground">
                  Complete OAuth flow to grant access to the mailbox
                </p>
              </div>
              <Button
                id="oauth-authorize-btn"
                type="button"
                variant="outline"
                onClick={handleOAuthAuthorization}
                disabled={!form.watch('clientId') || !form.watch('redirectUri') || oauthStatus === 'authorizing'}
              >
                {oauthStatus === 'authorizing' && 'Authorizing...'}
                {oauthStatus === 'success' && <><CheckCircle className="h-4 w-4 mr-2" />Authorized</>}
                {(oauthStatus === 'idle' || oauthStatus === 'error') && 'Authorize Access'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Advanced Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Advanced Settings</CardTitle>
          <CardDescription>
            Configure advanced email processing options
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <Switch
              id="autoProcessEmails"
              checked={form.watch('autoProcessEmails')}
              onCheckedChange={(checked: boolean) => form.setValue('autoProcessEmails', checked)}
            />
            <Label htmlFor="autoProcessEmails">Automatically process new emails</Label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="folderFilters">Folder Filters</Label>
              <Input
                id="folderFilters"
                {...form.register('folderFilters')}
                placeholder="Inbox, Support, Custom Folder"
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated list of folders to monitor (default: Inbox)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxEmailsPerSync">Max Emails Per Sync</Label>
              <Input
                id="maxEmailsPerSync"
                type="number"
                {...form.register('maxEmailsPerSync', { valueAsNumber: true })}
                min="1"
                max="1000"
              />
            </div>
          </div>

          {/* Ticket Defaults Selection */}
          <div className="space-y-2">
            <Label htmlFor="inboundTicketDefaultsId">Ticket Defaults</Label>
            <CustomSelect
              id="inboundTicketDefaultsId"
              value={form.watch('inboundTicketDefaultsId') || ''}
              onValueChange={(value) => form.setValue('inboundTicketDefaultsId', value || undefined)}
              options={[
                { value: '', label: 'No defaults configured' },
                ...ticketDefaults
                  .filter(d => d.is_active)
                  .map(d => ({ 
                    value: d.id, 
                    label: `${d.display_name} (${d.short_name})` 
                  }))
              ]}
              placeholder="Select ticket defaults"
              disabled={loadingDefaults}
            />
            <p className="text-xs text-muted-foreground">
              Default values applied to tickets created from emails
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Error Display */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Form Actions */}
      <div className="flex items-center justify-end space-x-2">
        <Button id="cancel-btn" type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button id="submit-btn" type="submit" disabled={loading}>
          {loading ? 'Saving...' : isEditing ? 'Update Provider' : 'Add Provider'}
        </Button>
      </div>
    </form>
  );
}