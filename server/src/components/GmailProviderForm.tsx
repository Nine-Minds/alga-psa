/**
 * Gmail Provider Configuration Form
 * Form for setting up Gmail integration via Google APIs
 */

'use client';

import React, { useState, useEffect } from 'react';
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
import { createEmailProvider, updateEmailProvider, upsertEmailProvider } from '../lib/actions/email-actions/emailProviderActions';
import { pubsub } from 'googleapis/build/src/apis/pubsub';

const gmailProviderSchema = z.object({
  providerName: z.string().min(1, 'Provider name is required'),
  mailbox: z.string().email('Valid Gmail address is required'),
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().min(1, 'Client Secret is required'),
  projectId: z.string().min(1, 'Google Cloud Project ID is required'),
  redirectUri: z.string().url('Valid redirect URI is required'),
  isActive: z.boolean(),
  autoProcessEmails: z.boolean(),
  labelFilters: z.string().optional(),
  maxEmailsPerSync: z.number().min(1).max(1000)
});

type GmailProviderFormData = z.infer<typeof gmailProviderSchema>;

interface GmailProviderFormProps {
  tenant: string;
  provider?: EmailProvider;
  onSuccess: (provider: EmailProvider) => void;
  onCancel: () => void;
}

export function GmailProviderForm({ 
  tenant, 
  provider, 
  onSuccess, 
  onCancel 
}: GmailProviderFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'authorizing' | 'success' | 'error'>('idle');
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [oauthData, setOauthData] = useState<any>(null);
  const [autoSubmitCountdown, setAutoSubmitCountdown] = useState<number | null>(null);

  const isEditing = !!provider;

  // Clean up countdown on unmount
  useEffect(() => {
    return () => {
      if (autoSubmitCountdown !== null) {
        setAutoSubmitCountdown(null);
      }
    };
  }, [autoSubmitCountdown]);

  const form = useForm<GmailProviderFormData>({
    resolver: zodResolver(gmailProviderSchema) as any,
    defaultValues: provider && provider.googleConfig ? {
      providerName: provider.providerName,
      mailbox: provider.mailbox,
      clientId: provider.googleConfig.client_id || undefined,
      clientSecret: provider.googleConfig.client_secret || undefined,
      projectId: provider.googleConfig.project_id || undefined,
      redirectUri: provider.googleConfig.redirect_uri || undefined,
      isActive: provider.isActive,
      autoProcessEmails: provider.googleConfig.auto_process_emails ?? true,
      labelFilters: provider.googleConfig.label_filters?.join(', ') || '',
      maxEmailsPerSync: provider.googleConfig.max_emails_per_sync ?? 50
    } : {
      redirectUri: `${window.location.origin}/api/auth/google/callback`,
      isActive: true,
      autoProcessEmails: true,
      labelFilters: '',
      maxEmailsPerSync: 50
    }
  });

  const onSubmit = async (data: GmailProviderFormData, providedOauthData?: any) => {
    setHasAttemptedSubmit(true);
    
    // Check if form is valid
    const isValid = await form.trigger();
    if (!isValid) {
      return;
    }
    
    try {
      setLoading(true);
      setError(null);

      // Use provided OAuth data if available, otherwise fall back to state
      const activeOauthData = providedOauthData || oauthData;

      // Debug OAuth data
      console.log('🔧 Submitting Gmail provider with OAuth data:', {
        hasProvidedOauthData: !!providedOauthData,
        hasStateOauthData: !!oauthData,
        hasActiveOauthData: !!activeOauthData,
        activeOauthDataKeys: activeOauthData ? Object.keys(activeOauthData) : 'N/A',
        activeOauthData: activeOauthData
      });

      const payload = {
        tenant,
        providerType: 'google',
        providerName: data.providerName,
        mailbox: data.mailbox,
        isActive: data.isActive,
        googleConfig: {
          client_id: data.clientId,
          client_secret: data.clientSecret,
          project_id: data.projectId,
          redirect_uri: data.redirectUri,
          auto_process_emails: data.autoProcessEmails,
          label_filters: data.labelFilters ? data.labelFilters.split(',').map(l => l.trim()) : ['INBOX'],
          max_emails_per_sync: data.maxEmailsPerSync,
          // Include OAuth tokens if available from authorization
          ...(activeOauthData && {
            access_token: activeOauthData.accessToken,
            refresh_token: activeOauthData.refreshToken,
            token_expires_at: activeOauthData.expiresAt
          })
        }
      };

      console.log('📤 Final payload being sent:', JSON.stringify(payload, null, 2));

      // For normal saves (not OAuth), skip automation to prevent duplicate Pub/Sub setup
      const result = isEditing 
        ? await updateEmailProvider(provider.id, payload, true) // skipAutomation: true
        : await createEmailProvider(payload, true); // skipAutomation: true

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

      // Validate required fields for OAuth
      const isValid = await form.trigger();
      if (!isValid) {
        setOauthStatus('error');
        setError('Please fill in all required fields before authorizing');
        return;
      }

      // Save provider first so credentials are available for OAuth
      let providerId = provider?.id;
      if (!providerId) {
        const payload = {
          tenant,
          providerType: 'google',
          providerName: formData.providerName,
          mailbox: formData.mailbox,
          isActive: formData.isActive,
          googleConfig: {
            client_id: formData.clientId,
            client_secret: formData.clientSecret,
            project_id: formData.projectId,
            redirect_uri: formData.redirectUri,
            auto_process_emails: formData.autoProcessEmails,
            label_filters: formData.labelFilters ? formData.labelFilters.split(',').map(l => l.trim()) : ['INBOX'],
            max_emails_per_sync: formData.maxEmailsPerSync
          }
        };

        // OAuth flow - allow automation for initial setup
        const result = await upsertEmailProvider(payload); // skipAutomation: false (default)
        providerId = result.provider.id;
      }

      // Get OAuth URL from API
      const response = await fetch('/api/email/oauth/initiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'google',
          redirectUri: formData.redirectUri,
          providerId: providerId
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
        'google-oauth',
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
        if (event.data.type === 'oauth-callback' && event.data.provider === 'google') {
          console.log('🔔 OAuth callback received:', {
            success: event.data.success,
            hasData: !!event.data.data,
            dataKeys: event.data.data ? Object.keys(event.data.data) : 'N/A',
            fullData: event.data
          });
          
          clearInterval(checkClosed);
          popup?.close();
          
          if (event.data.success) {
            // Store the authorization code and tokens in OAuth data (not form)
            // These are temporary OAuth fields, not part of the provider configuration
            
            console.log('💾 Storing OAuth data:', event.data.data);
            
            // Store tokens for the submit
            setOauthData(event.data.data);
            
            setOauthStatus('success');
            
            // Store the OAuth data for auto-submission (avoid React state timing issues)
            const oauthDataForSubmit = event.data.data;
            
            // Start countdown for auto-submission
            setAutoSubmitCountdown(10);
            const countdownInterval = setInterval(() => {
              setAutoSubmitCountdown(prev => {
                if (prev === null || prev <= 1) {
                  clearInterval(countdownInterval);
                  console.log('⏰ Auto-submitting form with OAuth data:', {
                    hasOauthData: !!oauthDataForSubmit,
                    oauthDataAtSubmit: oauthDataForSubmit
                  });
                  // Auto-submit the form with OAuth data
                  form.handleSubmit((data) => onSubmit(data, oauthDataForSubmit))();
                  return null;
                }
                return prev - 1;
              });
            }, 1000);
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
                className={hasAttemptedSubmit && form.formState.errors.mailbox ? 'border-red-500' : ''}
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
          <div className={`p-4 rounded-lg transition-colors ${
            oauthStatus === 'success' ? 'bg-green-50 border-2 border-green-200' : 'bg-blue-50'
          }`}>
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">Step 1: OAuth Authorization</h4>
                <p className="text-sm text-muted-foreground">
                  {oauthStatus === 'success' 
                    ? 'Successfully authorized! Now click "' + (isEditing ? 'Update Provider' : 'Add Provider') + '" below to complete setup.'
                    : 'Complete OAuth flow to grant access to Gmail'
                  }
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

          {/* Next Step Indicator */}
          {oauthStatus === 'success' && (
            <div className="bg-amber-50 border-2 border-amber-200 p-4 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center">
                      <span className="text-amber-600 font-semibold">2</span>
                    </div>
                  </div>
                  <div className="ml-3">
                    <h4 className="font-medium text-amber-800">Complete Setup</h4>
                    <p className="text-sm text-amber-700">
                      {autoSubmitCountdown !== null ? (
                        <>Auto-completing in <strong>{autoSubmitCountdown}</strong> seconds, or click "<strong>{isEditing ? 'Update Provider' : 'Add Provider'}</strong>" below now.</>
                      ) : (
                        <>Click "<strong>{isEditing ? 'Update Provider' : 'Add Provider'}</strong>" below to finish configuration and set up Gmail notifications.</>
                      )}
                    </p>
                  </div>
                </div>
                {autoSubmitCountdown !== null && (
                  <Button
                    id="cancel-auto-submit"
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setAutoSubmitCountdown(null);
                    }}
                  >
                    Cancel Auto-Submit
                  </Button>
                )}
              </div>
            </div>
          )}
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
            </ul>
          </AlertDescription>
        </Alert>
      )}
      
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* OAuth Warning */}
      {oauthStatus !== 'success' && (
        <div className="bg-yellow-50 border-2 border-yellow-200 p-4 rounded-lg">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center">
                <span className="text-yellow-600 font-semibold">⚠</span>
              </div>
            </div>
            <div className="ml-3">
              <h4 className="font-medium text-yellow-800">OAuth Authorization Required</h4>
              <p className="text-sm text-yellow-700">
                You must complete OAuth authorization above before {isEditing ? 'updating' : 'adding'} the provider to enable Gmail notifications.
              </p>
            </div>
          </div>
        </div>
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
          className={`${Object.keys(form.formState.errors).length > 0 && !loading ? 'opacity-50' : ''} ${
            oauthStatus === 'success' ? 'bg-green-600 hover:bg-green-700 animate-pulse' : ''
          }`}
        >
          {loading ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              Setting up Gmail notifications...
            </>
          ) : (
            <>
              {isEditing ? 'Update Provider' : 'Add Provider'}
              {oauthStatus === 'success' && ' & Complete Setup'}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}