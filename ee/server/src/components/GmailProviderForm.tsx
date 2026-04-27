/**
 * Enterprise Edition Gmail Provider Configuration Form
 * Tenant-owned Google OAuth configuration (same model as CE)
 */

'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Alert, AlertDescription, Card, CardContent, CardDescription, CardHeader, CardTitle, CustomSelect } from '@alga-psa/ui/components';
import { Shield } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { EmailProvider } from '@alga-psa/integrations/components/email/types';
import {
  createEmailProvider,
  updateEmailProvider,
  upsertEmailProvider,
} from '@alga-psa/integrations/actions/email-actions/emailProviderActions';
import { getInboundTicketDefaults } from '@alga-psa/integrations/actions/email-actions/inboundTicketDefaultsActions';
import { initiateEmailOAuth } from '@alga-psa/integrations/actions/email-actions/oauthActions';
import { getGoogleIntegrationStatus } from '@alga-psa/integrations/actions/integrations/googleActions';
import { useOAuthPopup } from '@alga-psa/integrations/components/email/providers/gmail/useOAuthPopup';
import { BasicConfigCard } from '@alga-psa/integrations/components/email/providers/gmail/BasicConfigCard';
import { ProcessingSettingsCard } from '@alga-psa/integrations/components/email/providers/gmail/ProcessingSettingsCard';
import { OAuthSection } from '@alga-psa/integrations/components/email/providers/gmail/OAuthSection';
import { baseGmailProviderSchema } from '@alga-psa/integrations/components/email/providers/gmail/schemas';

type EEGmailProviderFormData = import('@alga-psa/integrations/components').BaseGmailProviderFormData;

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
  const { t } = useTranslation('msp/email-providers');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupWarnings, setSetupWarnings] = useState<string[]>([]);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const { oauthStatus, oauthData, autoSubmitCountdown, openOAuthPopup, cancelAutoSubmit, setOauthStatus } = useOAuthPopup<any>({ provider: 'google', countdownSeconds: 0 });
  const [defaultsOptions, setDefaultsOptions] = useState<{ value: string; label: string }[]>([]);
  const [googleConfigReady, setGoogleConfigReady] = useState(false);

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

  // Load inbound ticket defaults options and listen for refresh
  React.useEffect(() => {
    const loadDefaults = async () => {
      try {
        const res = await getInboundTicketDefaults();
        const options = (res.defaults || []).map((d) => ({ value: d.id, label: d.display_name || d.short_name }));
        setDefaultsOptions(options);
      } catch (e) {
        console.error('Failed to load inbound defaults', e);
      }
    };
    loadDefaults();
    const onUpdate = () => loadDefaults();
    window.addEventListener('inbound-defaults-updated', onUpdate as any);
    return () => window.removeEventListener('inbound-defaults-updated', onUpdate as any);
  }, []);

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

      const payload = {
        tenant,
        providerType: 'google',
        providerName: data.providerName,
        mailbox: data.mailbox,
        isActive: data.isActive,
        inboundTicketDefaultsId: (form.getValues() as any).inboundTicketDefaultsId || undefined,
        googleConfig: {
          // Null client credentials indicate tenant-level OAuth is used
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
      };

      // After OAuth, run automation once to set up Pub/Sub + watch
      const result = isEditing
        ? await updateEmailProvider(provider.id, payload, false) // skipAutomation: false
        : await createEmailProvider(payload, false); // skipAutomation: false

      // Check for setup errors or warnings
      if (result.setupError) {
        setError(t('gmailForm.warnings.setupIncomplete', { error: result.setupError }));
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
        setError(t('gmailForm.oauth.fillRequiredFields'));
        return;
      }

      if (!googleConfigReady) {
        setOauthStatus('error');
        setError(t('gmailForm.oauth.notConfiguredTenant'));
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
          inboundTicketDefaultsId: (form.getValues() as any).inboundTicketDefaultsId || undefined,
          googleConfig: {
            // Null client credentials indicate tenant-level OAuth is used
            client_id: null,
            client_secret: null,
            auto_process_emails: formData.autoProcessEmails,
            label_filters: formData.labelFilters ? formData.labelFilters.split(',').map(l => l.trim()) : ['INBOX'],
            max_emails_per_sync: formData.maxEmailsPerSync ?? 50
          }
        };

        // Pre-auth save should not trigger automation yet (tokens absent)
        const result = await upsertEmailProvider(payload, true); // skipAutomation: true
        providerId = result.provider.id;
      }

      // Get OAuth URL from server action (tenant-owned OAuth configuration)
      const redirectUri = `${window.location.origin}/api/auth/google/callback`;
      const oauthResult = await initiateEmailOAuth({
        provider: 'google',
        redirectUri,
        providerId,
      });
      if (!oauthResult.success) {
        throw new Error('error' in oauthResult ? oauthResult.error : 'Failed to initiate OAuth');
      }
      const { authUrl } = oauthResult;

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
      {/* Header */}
      <Alert>
        <Shield className="h-4 w-4" />
        <AlertDescription>
          <strong>{t('gmailForm.header.title')}</strong> — {t('gmailForm.header.description')}
        </AlertDescription>
      </Alert>

      {/* Error Display (at top for visibility) */}
      {hasAttemptedSubmit && Object.keys(form.formState.errors).length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <p className="font-medium mb-2">{t('gmailForm.validation.requiredFieldsTitle')}</p>
            <ul className="list-disc list-inside space-y-1">
              {form.formState.errors.providerName && <li>{t('gmailForm.validation.providerName')}</li>}
              {form.formState.errors.mailbox && <li>{t('gmailForm.validation.mailbox')}</li>}
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
            <p className="font-medium mb-2">{t('gmailForm.warnings.setupWarningsTitle')}</p>
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
              <div className="font-medium">{t('gmailForm.googleConfig.notConfigured')}</div>
              <div className="text-sm">
                {t('gmailForm.googleConfig.configureHint')} <strong>{t('gmailForm.googleConfig.settingsPath')}</strong>.
              </div>
              <div>
                <Button
                  id="open-google-settings-btn"
                  type="button"
                  variant="outline"
                  onClick={() => {
                    window.location.href = '/msp/settings?tab=integrations&category=providers';
                  }}
                >
                  {t('gmailForm.googleConfig.openSettings')}
                </Button>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <BasicConfigCard
        form={form}
        hasAttemptedSubmit={hasAttemptedSubmit}
        title={t('gmailForm.basicConfig.title')}
        description={t('gmailForm.basicConfig.description')}
      />

      {/* Gmail Authentication */}
      <Card>
        <CardHeader>
          <CardTitle>{t('gmailForm.authentication.title')}</CardTitle>
          <CardDescription>
            {t('gmailForm.authentication.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <OAuthSection
            oauthStatus={oauthStatus}
            onAuthorize={handleOAuthAuthorization}
            authorizeButtonId="gmail-oauth-btn"
            buttonDisabled={!form.watch('mailbox') || !googleConfigReady}
            isEditing={isEditing}
            labels={{
              title: t('gmailForm.authentication.connectionTitle'),
              descriptionIdle: t('gmailForm.authentication.descriptionIdle'),
              descriptionSuccess: t('gmailForm.authentication.descriptionSuccess'),
              buttonIdleText: t('gmailForm.authentication.buttonIdle'),
              buttonAuthorizingText: t('gmailForm.authentication.buttonAuthorizing'),
              buttonSuccessText: t('gmailForm.authentication.buttonSuccess'),
            }}
          />
        </CardContent>
      </Card>

      <ProcessingSettingsCard
        form={form}
        title={t('gmailForm.processing.title')}
        description={t('gmailForm.processing.description')}
      />

      {/* Ticket Defaults selection */}
      <Card>
        <CardHeader>
          <CardTitle>{t('gmailForm.ticketDefaults.title')}</CardTitle>
          <CardDescription>
            {t('gmailForm.ticketDefaults.description')}
            <Button
              id="manage-defaults-link"
              type="button"
              variant="link"
              className="ml-2 p-0 h-auto"
              onClick={() => window.dispatchEvent(new CustomEvent('open-defaults-tab'))}
            >
              {t('gmailForm.ticketDefaults.manageDefaults')}
            </Button>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CustomSelect
            id="ee-gmail-inbound-defaults-select"
            label={t('gmailForm.ticketDefaults.inboundDefaultsLabel')}
            value={(form.watch('inboundTicketDefaultsId') as any) || ''}
            onValueChange={(v) => form.setValue('inboundTicketDefaultsId', v || undefined)}
            options={defaultsOptions}
            placeholder={t('gmailForm.ticketDefaults.inboundDefaultsPlaceholder')}
            allowClear
          />
          <div className="text-right">
            <Button id="refresh-defaults-list" type="button" variant="outline" size="sm" onClick={() => window.dispatchEvent(new CustomEvent('inbound-defaults-updated'))}>
              {t('gmailForm.ticketDefaults.refreshList')}
            </Button>
          </div>
        </CardContent>
      </Card>


      {/* OAuth Warning */}
      {oauthStatus !== 'success' && (
        <Alert variant="warning">
          <AlertDescription>
            <h4 className="font-medium">{t('gmailForm.oauth.requiredTitle')}</h4>
            <p className="text-sm">
              {isEditing ? t('gmailForm.oauth.requiredDescriptionUpdate') : t('gmailForm.oauth.requiredDescriptionAdd')}
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* Form Actions */}
      <div className="flex items-center justify-end space-x-2">
        <Button id="gmail-cancel-btn" type="button" variant="outline" onClick={onCancel}>
          {t('gmailForm.buttons.cancel')}
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
              {t('gmailForm.buttons.settingUp')}
            </>
          ) : (
            <>
              {isEditing ? t('gmailForm.buttons.updateProvider') : t('gmailForm.buttons.addProvider')}
              {oauthStatus === 'success' && ` ${t('gmailForm.buttons.completeSetupSuffix')}`}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
