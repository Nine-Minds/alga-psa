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
import { 
  autoWireEmailProvider, 
  updateEmailProvider 
} from '../lib/actions/email-actions/emailProviderActions';

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
  maxEmailsPerSync: z.number().min(1).max(1000)
});

type MicrosoftProviderFormData = z.infer<typeof microsoftProviderSchema>;

interface MicrosoftProviderFormProps {
  provider?: EmailProvider;
  onSuccess: (provider: EmailProvider) => void;
  onCancel: () => void;
}

export function MicrosoftProviderForm({ 
  provider, 
  onSuccess, 
  onCancel 
}: MicrosoftProviderFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'authorizing' | 'success' | 'error'>('idle');

  const isEditing = !!provider;

  const form = useForm<MicrosoftProviderFormData>({
    resolver: zodResolver(microsoftProviderSchema) as any,
    defaultValues: provider ? {
      providerName: provider.providerName,
      mailbox: provider.mailbox,
      clientId: provider.vendorConfig.clientId,
      clientSecret: provider.vendorConfig.clientSecret,
      tenantId: provider.vendorConfig.tenantId,
      redirectUri: provider.vendorConfig.redirectUri,
      isActive: provider.isActive,
      autoProcessEmails: provider.vendorConfig.autoProcessEmails ?? true,
      folderFilters: provider.vendorConfig.folderFilters?.join(', '),
      maxEmailsPerSync: provider.vendorConfig.maxEmailsPerSync ?? 50
    } : {
      redirectUri: `${window.location.origin}/api/auth/microsoft/callback`,
      isActive: true,
      autoProcessEmails: true,
      maxEmailsPerSync: 50
    }
  });

  const onSubmit = async (data: MicrosoftProviderFormData) => {
    try {
      setLoading(true);
      setError(null);

      if (isEditing && provider) {
        // Update existing provider
        const updatedProvider = await updateEmailProvider(provider.id, {
          providerName: data.providerName,
          isActive: data.isActive,
          vendorConfig: {
            ...provider.vendorConfig,
            clientId: data.clientId,
            clientSecret: data.clientSecret,
            tenantId: data.tenantId,
            redirectUri: data.redirectUri,
            autoProcessEmails: data.autoProcessEmails,
            folderFilters: data.folderFilters ? data.folderFilters.split(',').map(f => f.trim()) : ['Inbox'],
            maxEmailsPerSync: data.maxEmailsPerSync
          }
        });
        onSuccess(updatedProvider);
      } else {
        // Create new provider using auto-wire
        const result = await autoWireEmailProvider({
          providerType: 'microsoft',
          config: {
            providerName: data.providerName,
            mailbox: data.mailbox,
            tenantId: data.tenantId,
            clientId: data.clientId,
            clientSecret: data.clientSecret,
            folderFilters: data.folderFilters ? data.folderFilters.split(',').map(f => f.trim()) : ['Inbox'],
            autoProcessEmails: data.autoProcessEmails,
            maxEmailsPerSync: data.maxEmailsPerSync,
          }
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to save provider');
        }

        if (result.provider) {
          onSuccess(result.provider);
        }
      }

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
      
      // Construct OAuth URL
      const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
      authUrl.searchParams.set('client_id', formData.clientId);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', formData.redirectUri);
      authUrl.searchParams.set('scope', 'https://graph.microsoft.com/Mail.Read offline_access');
      authUrl.searchParams.set('state', btoa(JSON.stringify({ mailbox: formData.mailbox })));

      // Open OAuth window
      const popup = window.open(
        authUrl.toString(),
        'microsoft-oauth',
        'width=600,height=700,scrollbars=yes,resizable=yes'
      );

      // Listen for OAuth completion
      const checkClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(checkClosed);
          setOauthStatus('idle');
        }
      }, 1000);

      // Listen for success message from popup
      const messageHandler = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        
        if (event.data.type === 'MICROSOFT_OAUTH_SUCCESS') {
          clearInterval(checkClosed);
          popup?.close();
          setOauthStatus('success');
          window.removeEventListener('message', messageHandler);
        } else if (event.data.type === 'MICROSOFT_OAUTH_ERROR') {
          clearInterval(checkClosed);
          popup?.close();
          setOauthStatus('error');
          setError(event.data.error);
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