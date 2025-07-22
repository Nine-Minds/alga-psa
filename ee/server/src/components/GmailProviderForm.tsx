/**
 * Enterprise Edition Gmail Provider Configuration Form
 * Simplified form for hosted environments without Google Cloud configuration
 */

'use client';

import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Switch } from 'server/src/components/ui/Switch';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { CheckCircle, Clock, Shield } from 'lucide-react';
import type { EmailProvider } from 'server/src/components/EmailProviderConfiguration';
import { createEmailProvider, updateEmailProvider, upsertEmailProvider, getHostedGmailConfig } from 'server/src/lib/actions/email-actions/emailProviderActions';

const eeGmailProviderSchema = z.object({
  providerName: z.string().min(1, 'Provider name is required'),
  mailbox: z.string().email('Valid Gmail address is required'),
  isActive: z.boolean(),
  autoProcessEmails: z.boolean(),
  labelFilters: z.string().optional(),
  maxEmailsPerSync: z.number().min(1).max(1000)
});

type EEGmailProviderFormData = z.infer<typeof eeGmailProviderSchema>;

interface EEGmailProviderFormProps {
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
}: EEGmailProviderFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const form = useForm<EEGmailProviderFormData>({
    resolver: zodResolver(eeGmailProviderSchema) as any,
    defaultValues: provider && provider.googleConfig ? {
      providerName: provider.providerName,
      mailbox: provider.mailbox,
      isActive: provider.isActive,
      autoProcessEmails: provider.googleConfig.auto_process_emails ?? true,
      labelFilters: provider.googleConfig.label_filters?.join(', ') || '',
      maxEmailsPerSync: provider.googleConfig.max_emails_per_sync ?? 50
    } : {
      isActive: true,
      autoProcessEmails: true,
      labelFilters: '',
      maxEmailsPerSync: 50
    }
  });

  const onSubmit = async (data: EEGmailProviderFormData, providedOauthData?: any) => {
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

      // For EE, we use hosted Google Cloud project configuration
      const payload = {
        tenant,
        providerType: 'google',
        providerName: data.providerName,
        mailbox: data.mailbox,
        isActive: data.isActive,
        googleConfig: {
          // EE hosted environment handles OAuth credentials automatically
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
        // Get hosted Gmail configuration
        const hostedConfig = await getHostedGmailConfig();
        if (!hostedConfig || !hostedConfig.project_id || !hostedConfig.redirect_uri) {
          throw new Error('Hosted Gmail configuration not available or incomplete');
        }
        if (!hostedConfig.client_id || !hostedConfig.client_secret) {
          throw new Error('Hosted Gmail client credentials not available');
        }

        const payload = {
          tenant,
          providerType: 'google',
          providerName: formData.providerName,
          mailbox: formData.mailbox,
          isActive: formData.isActive,
          googleConfig: {
            auto_process_emails: formData.autoProcessEmails,
            label_filters: formData.labelFilters ? formData.labelFilters.split(',').map(l => l.trim()) : ['INBOX'],
            max_emails_per_sync: formData.maxEmailsPerSync,
            project_id: hostedConfig.project_id,
            client_id: hostedConfig.client_id,
            client_secret: hostedConfig.client_secret,
            redirect_uri: hostedConfig.redirect_uri
          }
        };

        // OAuth flow - allow automation for initial setup
        const result = await upsertEmailProvider(payload); // skipAutomation: false (default)
        providerId = result.provider.id;
      }

      // Get OAuth URL from API - EE version uses hosted OAuth configuration
      const response = await fetch('/api/email/oauth/initiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'google',
          providerId: providerId,
          hosted: true // Flag to indicate hosted environment
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
          clearInterval(checkClosed);
          popup?.close();
          
          if (event.data.success) {
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
      {/* Hosted Environment Header */}
      <Alert>
        <Shield className="h-4 w-4" />
        <AlertDescription>
          <strong>Gmail Integration</strong> - Simply connect your Gmail account and configure 
          your email processing preferences to get started.
        </AlertDescription>
      </Alert>

      {/* Basic Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Gmail Account Setup</CardTitle>
          <CardDescription>
            Configure your Gmail account for inbound email processing
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

      {/* Gmail Authentication */}
      <Card>
        <CardHeader>
          <CardTitle>Gmail Authentication</CardTitle>
          <CardDescription>
            Connect your Gmail account to enable email processing
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* OAuth Authorization */}
          <div className={`p-4 rounded-lg transition-colors ${
            oauthStatus === 'success' ? 'bg-green-50 border-2 border-green-200' : 'bg-blue-50'
          }`}>
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">Gmail Connection</h4>
                <p className="text-sm text-muted-foreground">
                  {oauthStatus === 'success' 
                    ? 'Successfully connected! Complete setup by saving below.'
                    : 'Authorize access to your Gmail account'
                  }
                </p>
              </div>
              <Button
                id="gmail-oauth-btn"
                type="button"
                variant="outline"
                onClick={handleOAuthAuthorization}
                disabled={!form.watch('mailbox') || oauthStatus === 'authorizing'}
              >
                {oauthStatus === 'authorizing' && (
                  <>
                    <Clock className="h-4 w-4 mr-2 animate-spin" />
                    Connecting...
                  </>
                )}
                {oauthStatus === 'success' && (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Connected
                  </>
                )}
                {(oauthStatus === 'idle' || oauthStatus === 'error') && 'Connect Gmail'}
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
                        <>Click "<strong>{isEditing ? 'Update Provider' : 'Add Provider'}</strong>" below to finish configuration.</>
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

      {/* Processing Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Email Processing Settings</CardTitle>
          <CardDescription>
            Configure how emails are processed and imported
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
              <Label htmlFor="labelFilters">Gmail Labels to Monitor</Label>
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
              <p className="text-xs text-muted-foreground">
                Maximum number of emails to process in each sync (1-1000)
              </p>
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
              <h4 className="font-medium text-yellow-800">Gmail Connection Required</h4>
              <p className="text-sm text-yellow-700">
                You must connect your Gmail account above before {isEditing ? 'updating' : 'adding'} the provider.
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
              Setting up Gmail integration...
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