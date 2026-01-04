/**
 * Gmail Provider Configuration Form
 * Form for setting up Gmail integration via Google APIs
 */

'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from './ui/Button';
import { Alert, AlertDescription } from './ui/Alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/Card';
import { ExternalLink } from 'lucide-react';
import type { EmailProvider } from './EmailProviderConfiguration';
import { createEmailProvider, updateEmailProvider, upsertEmailProvider } from '../lib/actions/email-actions/emailProviderActions';
import { initiateEmailOAuth } from 'server/src/lib/actions/email-actions/oauthActions';
import { useOAuthPopup } from './providers/gmail/useOAuthPopup';
import { BasicConfigCard } from './providers/gmail/BasicConfigCard';
import { ProcessingSettingsCard } from './providers/gmail/ProcessingSettingsCard';
import { OAuthSection } from './providers/gmail/OAuthSection';
import { ceGmailProviderSchema } from './providers/gmail/schemas';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { getInboundTicketDefaults } from 'server/src/lib/actions/email-actions/inboundTicketDefaultsActions';
import { getGoogleIntegrationStatus } from '@/lib/actions/integrations/googleActions';

type GmailProviderFormData = import('./providers/gmail/schemas').CEGmailProviderFormData;

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
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const { oauthStatus, oauthData, autoSubmitCountdown, openOAuthPopup, cancelAutoSubmit, setOauthStatus } = useOAuthPopup<any>({ provider: 'google', countdownSeconds: 0 });
  const [defaultsOptions, setDefaultsOptions] = useState<{ value: string; label: string }[]>([]);
  const [googleConfigReady, setGoogleConfigReady] = useState(false);

  const isEditing = !!provider;

  // No manual cleanup needed; handled by hook

  const form = useForm<GmailProviderFormData>({
    resolver: zodResolver(ceGmailProviderSchema) as any,
    defaultValues: provider && provider.googleConfig ? {
      providerName: provider.providerName,
      mailbox: provider.mailbox,
      isActive: provider.isActive,
      autoProcessEmails: provider.googleConfig.auto_process_emails ?? true,
      labelFilters: provider.googleConfig.label_filters?.join(', ') || '',
      maxEmailsPerSync: provider.googleConfig.max_emails_per_sync ?? 50,
      inboundTicketDefaultsId: (provider as any).inboundTicketDefaultsId || undefined
    } : {
      isActive: true,
      autoProcessEmails: true,
      labelFilters: '',
      maxEmailsPerSync: 50,
      inboundTicketDefaultsId: undefined
    }
  });

  React.useEffect(() => {
    const loadGoogleStatus = async () => {
      try {
        const res = await getGoogleIntegrationStatus();
        if (!res.success) {
          setGoogleConfigReady(false);
          return;
        }
        const hasClient = Boolean(res.config?.gmailClientId);
        const hasSecret = Boolean(res.config?.gmailClientSecretMasked);
        const hasProject = Boolean(res.config?.projectId);
        const hasSvc = Boolean(res.config?.hasServiceAccountKey);
        setGoogleConfigReady(hasClient && hasSecret && hasProject && hasSvc);
      } catch {
        setGoogleConfigReady(false);
      }
    };
    loadGoogleStatus();
  }, []);

  
  // Load inbound ticket defaults options
  React.useEffect(() => {
    const loadDefaults = async () => {
      try {
        const res = await getInboundTicketDefaults();
        const options = (res.defaults || []).map((d) => ({ value: d.id, label: d.display_name || d.short_name }));
        setDefaultsOptions(options);
      } catch (e) {
        // Non-fatal
        console.error('Failed to load inbound defaults', e);
      }
    };
    loadDefaults();
    const onUpdate = () => loadDefaults();
    window.addEventListener('inbound-defaults-updated', onUpdate as any);
    return () => window.removeEventListener('inbound-defaults-updated', onUpdate as any);
  }, []);

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
        inboundTicketDefaultsId: (form.getValues() as any).inboundTicketDefaultsId || undefined,
        googleConfig: {
          // Tenant-owned OAuth; persisted in tenant secrets (DB columns remain nullable).
          client_id: null,
          client_secret: null,
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

      }

      console.log('📤 Final payload being sent:', JSON.stringify(payload, null, 2));

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

  const handleFormSubmit = form.handleSubmit(
    onSubmit as any,
    () => setHasAttemptedSubmit(true)
  );

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

      if (!googleConfigReady) {
        setOauthStatus('error');
        setError('Google integration is not configured for this tenant. Configure Google first, then retry.');
        return;
      }

      // Ensure provider exists so credentials are available for OAuth
      let providerId = provider?.id;
      if (!providerId) {
        const payload = {
          tenant,
          providerType: 'google',
          providerName: formData.providerName,
          mailbox: formData.mailbox,
          isActive: formData.isActive,
          inboundTicketDefaultsId: (form.getValues() as any).inboundTicketDefaultsId || undefined,
          googleConfig: {
            // Tenant-owned OAuth; persisted in tenant secrets (DB columns remain nullable).
            client_id: null,
            client_secret: null,
            auto_process_emails: formData.autoProcessEmails,
            label_filters: formData.labelFilters ? formData.labelFilters.split(',').map(l => l.trim()) : ['INBOX'],
            max_emails_per_sync: formData.maxEmailsPerSync ?? 50
          }
        };
        const result = await upsertEmailProvider(payload); // allow automation for initial setup
        providerId = result.provider.id;
      }

      // Get OAuth URL from server action
      const redirectUri = `${window.location.origin}/api/auth/google/callback`;
      const oauthResult = await initiateEmailOAuth({
        provider: 'google',
        redirectUri,
        providerId: providerId,
      });

      if (!oauthResult.success) {
        throw new Error(oauthResult.error || 'Failed to initiate OAuth');
      }
      const { authUrl } = oauthResult;

      // Open popup and handle callback + auto-submit
      openOAuthPopup(authUrl, {
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
    <form noValidate onSubmit={handleFormSubmit} className="space-y-6">
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

      {!googleConfigReady && (
        <Alert variant="destructive">
          <AlertDescription>
            <div className="space-y-2">
              <div className="font-medium">Google integration is not configured for this tenant.</div>
              <div className="text-sm">
                Configure tenant-owned Google OAuth + Pub/Sub first: <strong>Settings → Integrations → Providers</strong>.
              </div>
              <div>
                <Button
                  id="gmail-open-google-settings"
                  type="button"
                  variant="outline"
                  onClick={() => {
                    window.location.href = '/msp/settings?tab=integrations&category=providers';
                  }}
                >
                  Open Google Settings
                </Button>
              </div>
            </div>
          </AlertDescription>
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

      {/* Basic Configuration */}
      <BasicConfigCard
        form={form}
        hasAttemptedSubmit={hasAttemptedSubmit}
        title="Basic Configuration"
        description="Basic settings for your Gmail email provider"
      />

      {/* Google OAuth */}
      <Card>
        <CardHeader>
          <CardTitle>Google OAuth</CardTitle>
          <CardDescription>
            Uses the tenant-owned Google app configured in <strong>Settings → Integrations → Providers</strong>.
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
          {!googleConfigReady && (
            <Alert variant="destructive">
              <AlertDescription>
                Google is not configured for this tenant. Configure Google settings before authorizing.
              </AlertDescription>
            </Alert>
          )}

          <OAuthSection
            oauthStatus={oauthStatus}
            onAuthorize={handleOAuthAuthorization}
            authorizeButtonId="gmail-oauth-btn"
            buttonDisabled={!googleConfigReady}
            isEditing={isEditing}
            labels={{
              title: 'Step 1: OAuth Authorization',
              descriptionIdle: 'Complete OAuth flow to grant access to Gmail',
              descriptionSuccess: 'Successfully authorized! Saving your settings...',
              buttonIdleText: 'Authorize Access',
              buttonAuthorizingText: 'Authorizing...',
              buttonSuccessText: 'Authorized',
            }}
          />
        </CardContent>
      </Card>

  {/* Ticket Defaults selection */}
  <Card>
    <CardHeader>
      <CardTitle>Ticket Defaults</CardTitle>
      <CardDescription>
        Select defaults to apply to email-created tickets
        <Button
          id="manage-defaults-link"
          type="button"
          variant="link"
          className="ml-2 p-0 h-auto"
          onClick={() => window.dispatchEvent(new CustomEvent('open-defaults-tab'))}
        >
          Manage defaults
        </Button>
      </CardDescription>
    </CardHeader>
    <CardContent>
      <CustomSelect
        id="gmail-inbound-defaults-select"
        label="Inbound Ticket Defaults"
        value={(form.watch('inboundTicketDefaultsId') as any) || ''}
        onValueChange={(v) => form.setValue('inboundTicketDefaultsId', v || undefined)}
        options={defaultsOptions}
        placeholder="Select defaults (optional)"
        allowClear
      />
      <div className="text-right">
        <Button id="refresh-defaults-list" type="button" variant="outline" size="sm" onClick={() => window.dispatchEvent(new CustomEvent('inbound-defaults-updated'))}>
          Refresh list
        </Button>
      </div>
    </CardContent>
  </Card>


      <ProcessingSettingsCard
        form={form}
        title="Advanced Settings"
        description="Configure advanced email processing options"
      />

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
