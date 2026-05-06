/**
 * Gmail Provider Configuration Form
 * Form for setting up Gmail integration via Google APIs
 */

'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { ExternalLink } from 'lucide-react';
import type { EmailProvider } from './types';
import { createEmailProvider, updateEmailProvider, upsertEmailProvider } from '@alga-psa/integrations/actions';
import { initiateEmailOAuth } from '@alga-psa/integrations/actions';
import { useOAuthPopup } from './providers/gmail/useOAuthPopup';
import { BasicConfigCard } from './providers/gmail/BasicConfigCard';
import { ProcessingSettingsCard } from './providers/gmail/ProcessingSettingsCard';
import { OAuthSection } from './providers/gmail/OAuthSection';
import { createCeGmailProviderSchema } from './providers/gmail/schemas';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { getInboundTicketDefaults } from '@alga-psa/integrations/actions';
import { getGoogleIntegrationStatus } from '@alga-psa/integrations/actions';

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
  const { t } = useTranslation('msp/email-providers');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupWarnings, setSetupWarnings] = useState<string[]>([]);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const { oauthStatus, oauthData, autoSubmitCountdown, openOAuthPopup, cancelAutoSubmit, setOauthStatus } = useOAuthPopup<any>({ provider: 'google', countdownSeconds: 0 });
  const [defaultsOptions, setDefaultsOptions] = useState<{ value: string; label: string }[]>([]);
  const [googleConfigReady, setGoogleConfigReady] = useState(false);

  const isEditing = !!provider;
  const gmailProviderSchema = createCeGmailProviderSchema(t);

  // No manual cleanup needed; handled by hook

  const form = useForm<GmailProviderFormData>({
    resolver: zodResolver(gmailProviderSchema) as any,
    defaultValues: provider && provider.googleConfig ? {
      providerName: provider.providerName,
      senderDisplayName: provider.senderDisplayName || '',
      mailbox: provider.mailbox,
      isActive: provider.isActive,
      autoProcessEmails: provider.googleConfig.auto_process_emails ?? true,
      labelFilters: provider.googleConfig.label_filters?.join(', ') || '',
      maxEmailsPerSync: provider.googleConfig.max_emails_per_sync ?? 50,
      inboundTicketDefaultsId: (provider as any).inboundTicketDefaultsId || undefined
    } : {
      senderDisplayName: '',
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
        senderDisplayName: data.senderDisplayName?.trim() || null,
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

      // Check for setup errors or warnings
      if (result.setupError) {
        setError(t('forms.gmail.messages.setupIncomplete', {
          defaultValue: 'Provider saved but setup incomplete: {{error}}',
          error: result.setupError,
        }));
      }
      if (result.setupWarnings && result.setupWarnings.length > 0) {
        setSetupWarnings(result.setupWarnings);
      }

      // Still call onSuccess so the provider appears in the list
      // The user can see the error/warning state in the UI
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
        setError(t('forms.gmail.validation.authorizeRequiresValid', { defaultValue: 'Please fill in all required fields before authorizing' }));
        return;
      }

      if (!googleConfigReady) {
        setOauthStatus('error');
        setError(t('forms.gmail.validation.googleNotConfigured', { defaultValue: 'Google integration is not configured for this tenant. Configure Google first, then retry.' }));
        return;
      }

      // Ensure provider exists so credentials are available for OAuth
      let providerId = provider?.id;
      if (!providerId) {
        const payload = {
          tenant,
          providerType: 'google',
          providerName: formData.providerName,
          senderDisplayName: formData.senderDisplayName?.trim() || null,
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
        throw new Error((oauthResult as { success: false; error: string }).error || t('forms.gmail.validation.oauthInitiateFailed', { defaultValue: 'Failed to initiate OAuth' }));
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
            <p className="font-medium mb-2">{t('forms.common.validation.requiredFieldsTitle', { defaultValue: 'Please fill in the required fields:' })}</p>
            <ul className="list-disc list-inside space-y-1">
              {form.formState.errors.providerName && <li>{t('forms.gmail.requiredFields.providerName', { defaultValue: 'Configuration Name' })}</li>}
              {form.formState.errors.mailbox && <li>{t('forms.gmail.requiredFields.gmailAddress', { defaultValue: 'Gmail Address' })}</li>}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {setupWarnings.length > 0 && (
        <Alert variant="warning">
          <AlertDescription>
            <p className="font-medium mb-2">{t('forms.gmail.messages.warningsTitle', { defaultValue: 'Setup completed with warnings:' })}</p>
            <ul className="list-disc list-inside space-y-1">
              {setupWarnings.map((warning, idx) => (
                <li key={idx}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {!googleConfigReady && (
        <Alert variant="destructive">
          <AlertDescription>
            <div className="space-y-2">
              <div className="font-medium">{t('forms.gmail.oauth.notConfigured', { defaultValue: 'Google integration is not configured for this tenant.' })}</div>
              <div className="text-sm">
                {t('forms.gmail.oauth.setupHelp', { defaultValue: 'Configure tenant-owned Google OAuth + Pub/Sub first: Settings → Integrations → Providers.' })}
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
                  {t('forms.gmail.oauth.openSettings', { defaultValue: 'Open Google Settings' })}
                </Button>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* OAuth Warning */}
      {oauthStatus !== 'success' && (
        <Alert variant="warning">
          <AlertDescription>
            <h4 className="font-medium">{t('forms.gmail.oauth.requiredTitle', { defaultValue: 'OAuth Authorization Required' })}</h4>
            <p className="text-sm mt-1">
              {isEditing
                ? t('forms.gmail.oauth.requiredDescriptionUpdate', {
                  defaultValue: 'You must complete OAuth authorization above before updating the provider to enable Gmail notifications.',
                })
                : t('forms.gmail.oauth.requiredDescriptionAdd', {
                  defaultValue: 'You must complete OAuth authorization above before adding the provider to enable Gmail notifications.',
                })}
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* Basic Configuration */}
      <BasicConfigCard
        form={form}
        hasAttemptedSubmit={hasAttemptedSubmit}
        title={t('forms.gmail.basic.title', { defaultValue: 'Basic Configuration' })}
        description={t('forms.gmail.basic.description', { defaultValue: 'Basic settings for your Gmail email provider' })}
      />

      {/* Google OAuth */}
      <Card>
        <CardHeader>
          <CardTitle>{t('forms.gmail.oauth.sectionTitle', { defaultValue: 'Google OAuth' })}</CardTitle>
          <CardDescription>
            {t('forms.gmail.oauth.sectionDescription', { defaultValue: 'Uses the tenant-owned Google app configured in Settings → Integrations → Providers.' })}
            <Button
              id="google-console-link"
              type="button"
              variant="link"
              className="p-0 h-auto ml-2"
              onClick={() => window.open('https://console.cloud.google.com/apis/credentials', '_blank')}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              {t('forms.gmail.oauth.setupLabel', { defaultValue: 'Google Cloud Console' })}
            </Button>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!googleConfigReady && (
            <Alert variant="destructive">
              <AlertDescription>
                {t('forms.gmail.oauth.notConfigured', { defaultValue: 'Google integration is not configured for this tenant.' })}
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
              title: t('forms.gmail.oauth.stepTitle', { defaultValue: 'Step 1: OAuth Authorization' }),
              descriptionIdle: t('forms.gmail.oauth.stepDescription', { defaultValue: 'Complete OAuth flow to grant access to Gmail' }),
              descriptionSuccess: t('forms.gmail.oauth.buttonSuccessSaving', { defaultValue: 'Successfully authorized! Saving your settings...' }),
              buttonIdleText: t('forms.common.oauth.authorizeAccess', { defaultValue: 'Authorize Access' }),
              buttonAuthorizingText: t('forms.common.oauth.authorizing', { defaultValue: 'Authorizing...' }),
              buttonSuccessText: t('forms.common.oauth.authorized', { defaultValue: 'Authorized' }),
            }}
          />
        </CardContent>
      </Card>

  {/* Ticket Defaults selection */}
  <Card>
    <CardHeader>
      <CardTitle>{t('forms.common.ticketDefaults.title', { defaultValue: 'Ticket Defaults' })}</CardTitle>
      <CardDescription>
        {t('forms.common.ticketDefaults.description', { defaultValue: 'Select defaults to apply to email-created tickets' })}
        <Button
          id="manage-defaults-link"
          type="button"
          variant="link"
          className="ml-2 p-0 h-auto"
          onClick={() => window.dispatchEvent(new CustomEvent('open-defaults-tab'))}
        >
          {t('forms.common.actions.manageDefaults', { defaultValue: 'Manage defaults' })}
        </Button>
      </CardDescription>
    </CardHeader>
    <CardContent>
      <CustomSelect
        id="gmail-inbound-defaults-select"
        label={t('forms.common.ticketDefaults.label', { defaultValue: 'Inbound Ticket Defaults' })}
        value={(form.watch('inboundTicketDefaultsId') as any) || ''}
        onValueChange={(v) => form.setValue('inboundTicketDefaultsId', v || undefined)}
        options={defaultsOptions}
        placeholder={t('forms.common.ticketDefaults.placeholder', { defaultValue: 'Select defaults (optional)' })}
        allowClear
      />
      <div className="text-right">
        <Button id="refresh-defaults-list" type="button" variant="outline" size="sm" onClick={() => window.dispatchEvent(new CustomEvent('inbound-defaults-updated'))}>
          {t('forms.common.actions.refreshList', { defaultValue: 'Refresh list' })}
        </Button>
      </div>
    </CardContent>
  </Card>


      <ProcessingSettingsCard
        form={form}
        title={t('forms.gmail.advanced.title', { defaultValue: 'Advanced Settings' })}
        description={t('forms.gmail.advanced.description', { defaultValue: 'Configure advanced email processing options' })}
      />

      {/* Form Actions */}
      <div className="flex items-center justify-end space-x-2">
        <Button id="gmail-cancel-btn" type="button" variant="outline" onClick={onCancel}>
          {t('forms.common.actions.cancel', { defaultValue: 'Cancel' })}
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
              {t('forms.gmail.messages.settingUp', { defaultValue: 'Setting up Gmail notifications...' })}
            </>
          ) : (
            <>
              {isEditing
                ? t('forms.common.actions.updateProvider', { defaultValue: 'Update Provider' })
                : t('forms.common.actions.addProvider', { defaultValue: 'Add Provider' })}
              {oauthStatus === 'success' && t('forms.gmail.advanced.completeSetupSuffix', { defaultValue: ' & Complete Setup' })}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
