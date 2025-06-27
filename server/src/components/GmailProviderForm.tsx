/**
 * Gmail Provider Configuration Form
 * Form for setting up Gmail integration via Google APIs
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

const gmailProviderSchema = z.object({
  providerName: z.string().min(1, 'Provider name is required'),
  mailbox: z.string().email('Valid Gmail address is required'),
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().min(1, 'Client Secret is required'),
  projectId: z.string().min(1, 'Google Cloud Project ID is required'),
  redirectUri: z.string().url('Valid redirect URI is required'),
  pubsubTopicName: z.string().min(1, 'Pub/Sub topic name is required'),
  pubsubSubscriptionName: z.string().min(1, 'Pub/Sub subscription name is required'),
  isActive: z.boolean(),
  autoProcessEmails: z.boolean(),
  labelFilters: z.string().optional(),
  maxEmailsPerSync: z.number().min(1).max(1000)
});

type GmailProviderFormData = z.infer<typeof gmailProviderSchema>;

interface GmailProviderFormProps {
  provider?: EmailProvider;
  onSuccess: (provider: EmailProvider) => void;
  onCancel: () => void;
}

export function GmailProviderForm({ 
  provider, 
  onSuccess, 
  onCancel 
}: GmailProviderFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'authorizing' | 'success' | 'error'>('idle');
  const [pubsubStatus, setPubsubStatus] = useState<'idle' | 'creating' | 'success' | 'error'>('idle');
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const isEditing = !!provider;

  const form = useForm<GmailProviderFormData>({
    resolver: zodResolver(gmailProviderSchema) as any,
    mode: 'onBlur',
    defaultValues: provider ? {
      providerName: provider.providerName,
      mailbox: provider.mailbox,
      clientId: provider.vendorConfig.clientId,
      clientSecret: provider.vendorConfig.clientSecret,
      projectId: provider.vendorConfig.projectId,
      redirectUri: provider.vendorConfig.redirectUri,
      pubsubTopicName: provider.vendorConfig.pubsubTopicName,
      pubsubSubscriptionName: provider.vendorConfig.pubsubSubscriptionName,
      isActive: provider.isActive,
      autoProcessEmails: provider.vendorConfig.autoProcessEmails ?? true,
      labelFilters: provider.vendorConfig.labelFilters?.join(', '),
      maxEmailsPerSync: provider.vendorConfig.maxEmailsPerSync ?? 50
    } : {
      redirectUri: `${window.location.origin}/api/auth/google/callback`,
      pubsubTopicName: 'gmail-notifications',
      pubsubSubscriptionName: 'gmail-webhook-subscription',
      isActive: true,
      autoProcessEmails: true,
      maxEmailsPerSync: 50
    }
  });

  const onSubmit = async (data: GmailProviderFormData) => {
    setHasAttemptedSubmit(true);
    
    // Check if form is valid
    const isValid = await form.trigger();
    if (!isValid) {
      return;
    }
    
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
            projectId: data.projectId,
            redirectUri: data.redirectUri,
            pubsubTopicName: data.pubsubTopicName,
            pubsubSubscriptionName: data.pubsubSubscriptionName,
            autoProcessEmails: data.autoProcessEmails,
            labelFilters: data.labelFilters ? data.labelFilters.split(',').map(l => l.trim()) : ['INBOX'],
            maxEmailsPerSync: data.maxEmailsPerSync
          }
        });
        onSuccess(updatedProvider);
      } else {
        // Create new provider using auto-wire
        const result = await autoWireEmailProvider({
          providerType: 'google',
          config: {
            providerName: data.providerName,
            mailbox: data.mailbox,
            clientId: data.clientId,
            clientSecret: data.clientSecret,
            projectId: data.projectId,
            pubSubTopic: data.pubsubTopicName,
            pubSubSubscription: data.pubsubSubscriptionName,
            labelFilters: data.labelFilters ? data.labelFilters.split(',').map(l => l.trim()) : ['INBOX'],
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
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', formData.clientId);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', formData.redirectUri);
      authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify');
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');
      authUrl.searchParams.set('state', btoa(JSON.stringify({ mailbox: formData.mailbox })));

      // Open OAuth window
      const popup = window.open(
        authUrl.toString(),
        'google-oauth',
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
        
        if (event.data.type === 'GOOGLE_OAUTH_SUCCESS') {
          clearInterval(checkClosed);
          popup?.close();
          setOauthStatus('success');
          window.removeEventListener('message', messageHandler);
        } else if (event.data.type === 'GOOGLE_OAUTH_ERROR') {
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

  const handlePubSubSetup = async () => {
    try {
      setPubsubStatus('creating');
      setError(null);

      const formData = form.getValues();
      
      const response = await fetch('/api/email/providers/setup-pubsub', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          projectId: formData.projectId,
          topicName: formData.pubsubTopicName,
          subscriptionName: formData.pubsubSubscriptionName,
          webhookUrl: `${window.location.origin}/api/email/webhooks/google`
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to setup Pub/Sub');
      }

      setPubsubStatus('success');

    } catch (err: any) {
      setPubsubStatus('error');
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
            Basic settings for your Gmail email provider
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="providerName">Provider Name *</Label>
              <Input
                id="providerName"
                {...form.register('providerName')}
                placeholder="e.g., Support Gmail"
                className={hasAttemptedSubmit && form.formState.errors.providerName ? 'border-red-500' : ''}
              />
              {form.formState.errors.providerName && (
                <p className="text-sm text-red-500">{form.formState.errors.providerName.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="mailbox">Gmail Address *</Label>
              <Input
                id="mailbox"
                type="email"
                {...form.register('mailbox')}
                placeholder="support@company.com"
                className={form.formState.errors.mailbox ? 'border-red-500' : ''}
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

      {/* Google OAuth Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Google OAuth Configuration</CardTitle>
          <CardDescription>
            Configure OAuth settings from your Google Cloud Console
            <Button 
              id="google-console-link"
              type="button" 
              variant="link" 
              className="p-0 h-auto ml-2"
              onClick={() => window.open('https://console.cloud.google.com/apis/credentials', '_blank')}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              Google Cloud Console
            </Button>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="projectId">Google Cloud Project ID *</Label>
            <Input
              id="projectId"
              {...form.register('projectId')}
              placeholder="my-project-id"
              className={hasAttemptedSubmit && form.formState.errors.projectId ? 'border-red-500' : ''}
            />
            {form.formState.errors.projectId && (
              <p className="text-sm text-red-500">{form.formState.errors.projectId.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="clientId">Client ID *</Label>
              <Input
                id="clientId"
                {...form.register('clientId')}
                placeholder="xxxxxxxxx.apps.googleusercontent.com"
                className={hasAttemptedSubmit && form.formState.errors.clientId ? 'border-red-500' : ''}
              />
              {form.formState.errors.clientId && (
                <p className="text-sm text-red-500">{form.formState.errors.clientId.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="clientSecret">Client Secret *</Label>
              <div className="relative">
                <Input
                  id="clientSecret"
                  type={showClientSecret ? 'text' : 'password'}
                  {...form.register('clientSecret')}
                  placeholder="Enter client secret"
                  className={hasAttemptedSubmit && form.formState.errors.clientSecret ? 'border-red-500' : ''}
                />
                <Button
                  id="toggle-gmail-secret"
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
          </div>

          <div className="space-y-2">
            <Label htmlFor="redirectUri">Redirect URI *</Label>
            <Input
              id="redirectUri"
              {...form.register('redirectUri')}
              placeholder="https://yourapp.com/api/auth/google/callback"
              className={hasAttemptedSubmit && form.formState.errors.redirectUri ? 'border-red-500' : ''}
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
                  Complete OAuth flow to grant access to Gmail
                </p>
              </div>
              <Button
                id="gmail-oauth-btn"
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

      {/* Google Pub/Sub Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Pub/Sub Configuration</CardTitle>
          <CardDescription>
            Configure Google Cloud Pub/Sub for real-time email notifications
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pubsubTopicName">Pub/Sub Topic Name *</Label>
              <Input
                id="pubsubTopicName"
                {...form.register('pubsubTopicName')}
                placeholder="gmail-notifications"
                className={hasAttemptedSubmit && form.formState.errors.pubsubTopicName ? 'border-red-500' : ''}
              />
              {form.formState.errors.pubsubTopicName && (
                <p className="text-sm text-red-500">{form.formState.errors.pubsubTopicName.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="pubsubSubscriptionName">Subscription Name *</Label>
              <Input
                id="pubsubSubscriptionName"
                {...form.register('pubsubSubscriptionName')}
                placeholder="gmail-webhook-subscription"
                className={hasAttemptedSubmit && form.formState.errors.pubsubSubscriptionName ? 'border-red-500' : ''}
              />
              {form.formState.errors.pubsubSubscriptionName && (
                <p className="text-sm text-red-500">{form.formState.errors.pubsubSubscriptionName.message}</p>
              )}
            </div>
          </div>

          {/* Pub/Sub Setup */}
          <div className="bg-green-50 p-4 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">Pub/Sub Setup</h4>
                <p className="text-sm text-muted-foreground">
                  Create topic and subscription for Gmail push notifications
                </p>
              </div>
              <Button
                id="pubsub-setup-btn"
                type="button"
                variant="outline"
                onClick={handlePubSubSetup}
                disabled={!form.watch('projectId') || !form.watch('pubsubTopicName') || pubsubStatus === 'creating'}
              >
                {pubsubStatus === 'creating' && 'Setting up...'}
                {pubsubStatus === 'success' && <><CheckCircle className="h-4 w-4 mr-2" />Configured</>}
                {(pubsubStatus === 'idle' || pubsubStatus === 'error') && 'Setup Pub/Sub'}
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
              <Label htmlFor="labelFilters">Label Filters</Label>
              <Input
                id="labelFilters"
                {...form.register('labelFilters')}
                placeholder="INBOX, Support, Custom Label"
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated list of Gmail labels to monitor (default: INBOX)
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
      {hasAttemptedSubmit && Object.keys(form.formState.errors).length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <p className="font-medium mb-2">Please fill in the required fields:</p>
            <ul className="list-disc list-inside space-y-1">
              {form.formState.errors.providerName && <li>Provider Name</li>}
              {form.formState.errors.mailbox && <li>Gmail Address</li>}
              {form.formState.errors.projectId && <li>Google Cloud Project ID</li>}
              {form.formState.errors.clientId && <li>Client ID</li>}
              {form.formState.errors.clientSecret && <li>Client Secret</li>}
              {form.formState.errors.redirectUri && <li>Redirect URI</li>}
              {form.formState.errors.pubsubTopicName && <li>Pub/Sub Topic Name</li>}
              {form.formState.errors.pubsubSubscriptionName && <li>Subscription Name</li>}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Form Actions */}
      <div className="flex items-center justify-end space-x-2">
        <Button id="gmail-cancel-btn" type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button 
          id="gmail-submit-btn" 
          type="submit" 
          disabled={loading}
          className={Object.keys(form.formState.errors).length > 0 && !loading ? 'opacity-50' : ''}
        >
          {loading ? 'Saving...' : isEditing ? 'Update Provider' : 'Add Provider'}
        </Button>
      </div>
    </form>
  );
}