/**
 * Enterprise Edition Gmail Provider Configuration Form
 * Simplified form for hosted environments without Google Cloud configuration
 */

'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from 'server/src/components/ui/Button';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Shield } from 'lucide-react';
import type { EmailProvider } from 'server/src/components/EmailProviderConfiguration';
import { createEmailProvider, updateEmailProvider, upsertEmailProvider, getHostedGmailConfig, initiateOAuth } from 'server/src/lib/actions/email-actions/emailProviderActions';
import { useOAuthPopup } from 'server/src/components/providers/gmail/useOAuthPopup';
import { BasicConfigCard } from 'server/src/components/providers/gmail/BasicConfigCard';
import { ProcessingSettingsCard } from 'server/src/components/providers/gmail/ProcessingSettingsCard';
import { OAuthSection } from 'server/src/components/providers/gmail/OAuthSection';
import { baseGmailProviderSchema } from 'server/src/components/providers/gmail/schemas';

type EEGmailProviderFormData = import('server/src/components/providers/gmail/schemas').BaseGmailProviderFormData;

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
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const { oauthStatus, oauthData, autoSubmitCountdown, openOAuthPopup, cancelAutoSubmit, setOauthStatus } = useOAuthPopup<any>({ provider: 'google', countdownSeconds: 0 });

  const isEditing = !!provider;

  // No manual cleanup needed; handled by hook

  const form = useForm<EEGmailProviderFormData>({
    resolver: zodResolver(baseGmailProviderSchema) as any,
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

      // After OAuth, run automation once to set up Pub/Sub + watch
      const result = isEditing 
        ? await updateEmailProvider(provider.id, payload, false) // skipAutomation: false
        : await createEmailProvider(payload, false); // skipAutomation: false

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

        // Pre-auth save should not trigger automation yet (tokens absent)
        const result = await upsertEmailProvider(payload, true); // skipAutomation: true
        providerId = result.provider.id;
      }

      // Get OAuth URL from server action (hosted OAuth configuration)
      const oauthResult = await initiateOAuth({
        provider: 'google',
        providerId,
        hosted: true,
      });
      if (!oauthResult.success || !oauthResult.authUrl) {
        throw new Error(oauthResult.error || 'Failed to initiate OAuth');
      }

      openOAuthPopup(oauthResult.authUrl, {
        onAfterSuccess: () => {},
        onAutoSubmit: (oauthDataForSubmit) => {
          form.handleSubmit((data) => onSubmit(data, oauthDataForSubmit))();
        },
        onError: (message) => setError(message),
      });

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

      <BasicConfigCard
        form={form}
        hasAttemptedSubmit={hasAttemptedSubmit}
        title="Gmail Account Setup"
        description="Configure your Gmail account for inbound email processing"
      />

      {/* Gmail Authentication */}
      <Card>
        <CardHeader>
          <CardTitle>Gmail Authentication</CardTitle>
          <CardDescription>
            Connect your Gmail account to enable email processing
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <OAuthSection
            oauthStatus={oauthStatus}
            onAuthorize={handleOAuthAuthorization}
            authorizeButtonId="gmail-oauth-btn"
            buttonDisabled={!form.watch('mailbox')}
            isEditing={isEditing}
            autoSubmitCountdown={autoSubmitCountdown}
            onCancelAutoSubmit={cancelAutoSubmit}
            labels={{
              title: 'Gmail Connection',
              descriptionIdle: 'Authorize access to your Gmail account',
              descriptionSuccess: 'Successfully connected! Complete setup by saving below.',
              buttonIdleText: 'Connect Gmail',
              buttonAuthorizingText: 'Connecting...',
              buttonSuccessText: 'Connected',
            }}
          />
        </CardContent>
      </Card>

      <ProcessingSettingsCard
        form={form}
        title="Email Processing Settings"
        description="Configure how emails are processed and imported"
      />

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
