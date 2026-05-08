/**
 * Enterprise Edition Microsoft Provider Configuration Form
 * Simplified form for hosted environments without Azure AD configuration
 */

'use client';

import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button, Input, Label, Switch, Alert, AlertDescription, Card, CardContent, CardDescription, CardHeader, CardTitle, CustomSelect } from '@alga-psa/ui/components';
import { CheckCircle, Clock, Shield } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { EmailProvider } from '@alga-psa/integrations/components/email/types';
import {
  createEmailProvider,
  updateEmailProvider,
  upsertEmailProvider,
  getHostedMicrosoftConfig,
} from '@alga-psa/integrations/actions/email-actions/emailProviderActions';
import { getInboundTicketDefaults } from '@alga-psa/integrations/actions/email-actions/inboundTicketDefaultsActions';
import { initiateEmailOAuth } from '@alga-psa/integrations/actions/email-actions/oauthActions';

const eeMicrosoftProviderSchema = z.object({
  providerName: z.string().min(1, 'Configuration name is required'),
  senderDisplayName: z
    .string()
    .max(255)
    .refine((value) => !/[\x00-\x1F\x7F"<>]/.test(value), 'Display name cannot contain quotes, angle brackets, or line breaks')
    .optional(),
  mailbox: z.string().email('Valid email address is required'),
  isActive: z.boolean(),
  autoProcessEmails: z.boolean(),
  folderFilters: z.string().optional(),
  maxEmailsPerSync: z.number().min(1).max(1000),
  inboundTicketDefaultsId: z.string().uuid().optional()
});

type EEMicrosoftProviderFormData = z.infer<typeof eeMicrosoftProviderSchema>;

interface EEMicrosoftProviderFormProps {
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
}: EEMicrosoftProviderFormProps) {
  const { t } = useTranslation('msp/email-providers');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'authorizing' | 'success' | 'error'>('idle');
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [oauthData, setOauthData] = useState<any>(null);
  const [autoSubmitCountdown, setAutoSubmitCountdown] = useState<number | null>(null);
  const [defaultsOptions, setDefaultsOptions] = useState<{ value: string; label: string }[]>([]);

  const isEditing = !!provider;

  // Clean up countdown on unmount
  useEffect(() => {
    return () => {
      if (autoSubmitCountdown !== null) {
        setAutoSubmitCountdown(null);
      }
    };
  }, [autoSubmitCountdown]);

  const form = useForm<EEMicrosoftProviderFormData>({
    resolver: zodResolver(eeMicrosoftProviderSchema) as any,
    defaultValues: provider && provider.microsoftConfig ? {
      providerName: provider.providerName,
      senderDisplayName: provider.senderDisplayName || '',
      mailbox: provider.mailbox,
      isActive: provider.isActive,
      autoProcessEmails: provider.microsoftConfig.auto_process_emails ?? true,
      folderFilters: provider.microsoftConfig.folder_filters?.join(', ') || '',
      maxEmailsPerSync: provider.microsoftConfig.max_emails_per_sync ?? 50,
      inboundTicketDefaultsId: (provider as any).inboundTicketDefaultsId || undefined
    } : {
      senderDisplayName: '',
      isActive: true,
      autoProcessEmails: true,
      folderFilters: '',
      maxEmailsPerSync: 50,
      inboundTicketDefaultsId: undefined
    }
  });

  // Load inbound ticket defaults and respond to refresh event
  useEffect(() => {
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

  const onSubmit = async (data: EEMicrosoftProviderFormData, providedOauthData?: any) => {
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

      // For EE, we use hosted Microsoft configuration
      const payload = {
        tenant,
        providerType: 'microsoft',
        providerName: data.providerName,
        senderDisplayName: data.senderDisplayName?.trim() || null,
        mailbox: data.mailbox,
        isActive: data.isActive,
        inboundTicketDefaultsId: data.inboundTicketDefaultsId,
        microsoftConfig: {
          // Null client credentials indicate EE hosted environment handles OAuth
          client_id: null,
          client_secret: null,
          tenant_id: 'common',
          redirect_uri: `${typeof window !== 'undefined' ? window.location.origin : ''}/api/auth/microsoft/callback`,
          auto_process_emails: data.autoProcessEmails,
          folder_filters: data.folderFilters ? data.folderFilters.split(',').map(f => f.trim()) : ['Inbox'],
          max_emails_per_sync: data.maxEmailsPerSync,
          // Include OAuth tokens if available from authorization
          ...(activeOauthData && {
            access_token: activeOauthData.accessToken,
            refresh_token: activeOauthData.refreshToken,
            token_expires_at: activeOauthData.expiresAt
          })
        }
      };

      // For normal saves (not OAuth), skip automation to prevent duplicate setup
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
        setError(t('microsoftForm.oauth.authError'));
        return;
      }

      // Save provider first so credentials are available for OAuth
      let providerId = provider?.id;
      if (!providerId) {
        // Get hosted Microsoft configuration
        const hostedConfig = await getHostedMicrosoftConfig();
        if (!hostedConfig || !hostedConfig.tenant_id || !hostedConfig.redirect_uri) {
          throw new Error('Hosted Microsoft configuration not available or incomplete');
        }
        if (!hostedConfig.client_id || !hostedConfig.client_secret) {
          throw new Error('Hosted Microsoft client credentials not available');
        }

        const payload = {
          tenant,
          providerType: 'microsoft',
          providerName: formData.providerName,
          senderDisplayName: formData.senderDisplayName?.trim() || null,
          mailbox: formData.mailbox,
          isActive: formData.isActive,
          inboundTicketDefaultsId: (form.getValues() as any).inboundTicketDefaultsId || undefined,
          microsoftConfig: {
            auto_process_emails: formData.autoProcessEmails,
            folder_filters: formData.folderFilters ? formData.folderFilters.split(',').map(f => f.trim()) : ['Inbox'],
            max_emails_per_sync: formData.maxEmailsPerSync,
            tenant_id: hostedConfig.tenant_id,
            client_id: hostedConfig.client_id,
            client_secret: hostedConfig.client_secret,
            redirect_uri: hostedConfig.redirect_uri
          }
        };

        // OAuth flow - allow automation for initial setup
        const result = await upsertEmailProvider(payload); // skipAutomation: false (default)
        providerId = result.provider.id;
      }

      // Get OAuth URL via server action (hosted config auto-detected)
      const oauthInit = await initiateEmailOAuth({
        provider: 'microsoft',
        providerId,
      });
      if (!oauthInit.success) {
        throw new Error('error' in oauthInit ? oauthInit.error : 'Failed to initiate OAuth');
      }
      const { authUrl } = oauthInit;

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
            setError(event.data.errorDescription || event.data.error || t('microsoftForm.oauth.authorizationFailed'));
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
          <strong>{t('microsoftForm.header.title')}</strong> - {t('microsoftForm.header.description')}
        </AlertDescription>
      </Alert>

      {/* Basic Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>{t('microsoftForm.sections.accountSetup.title')}</CardTitle>
          <CardDescription>
            {t('microsoftForm.sections.accountSetup.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="providerName">{t('microsoftForm.fields.providerNameLabel', { defaultValue: 'Configuration Name *' })}</Label>
              <Input
                id="providerName"
                {...form.register('providerName')}
                placeholder={t('microsoftForm.fields.providerNamePlaceholder', { defaultValue: 'e.g., Support Mailbox (internal)' })}
                className={hasAttemptedSubmit && form.formState.errors.providerName ? 'border-destructive' : ''}
              />
              <p className="text-xs text-muted-foreground">
                {t('microsoftForm.fields.providerNameHelp', { defaultValue: 'Internal name used to identify this configuration. Not shown in outbound emails.' })}
              </p>
              {form.formState.errors.providerName && (
                <p className="text-sm text-destructive">{form.formState.errors.providerName.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="mailbox">{t('microsoftForm.fields.mailboxLabel')}</Label>
              <Input
                id="mailbox"
                type="email"
                {...form.register('mailbox')}
                placeholder={t('microsoftForm.fields.mailboxPlaceholder')}
                className={hasAttemptedSubmit && form.formState.errors.mailbox ? 'border-destructive' : ''}
              />
              {form.formState.errors.mailbox && (
                <p className="text-sm text-destructive">{form.formState.errors.mailbox.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="senderDisplayName">{t('microsoftForm.fields.senderDisplayNameLabel', { defaultValue: 'Sender Display Name' })}</Label>
            <Input
              id="senderDisplayName"
              {...form.register('senderDisplayName')}
              placeholder={t('microsoftForm.fields.senderDisplayNamePlaceholder', { defaultValue: 'e.g., Acme Support' })}
            />
            <p className="text-xs text-muted-foreground">
              {t('microsoftForm.fields.senderDisplayNameHelp', { defaultValue: 'Display name shown in the From header on outbound ticket emails (replies, closures). Applied only when this mailbox matches the tenant\'s outbound ticketing-from address. Leave blank to fall back to the ticket\'s board name.' })}
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="isActive"
              checked={form.watch('isActive')}
              onCheckedChange={(checked: boolean) => form.setValue('isActive', checked)}
            />
            <Label htmlFor="isActive">{t('microsoftForm.fields.enableProvider')}</Label>
          </div>
        </CardContent>
      </Card>

      {/* Microsoft Authentication */}
      <Card>
        <CardHeader>
          <CardTitle>{t('microsoftForm.sections.authentication.title')}</CardTitle>
          <CardDescription>
            {t('microsoftForm.sections.authentication.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* OAuth Authorization */}
          <div className={`p-4 rounded-lg transition-colors ${
            oauthStatus === 'success' ? 'bg-success/10 border-2 border-success/30' : 'bg-primary-500/10'
          }`}>
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">{t('microsoftForm.oauth.connectionTitle')}</h4>
                <p className="text-sm text-muted-foreground">
                  {oauthStatus === 'success'
                    ? t('microsoftForm.oauth.descriptionSuccess')
                    : t('microsoftForm.oauth.descriptionIdle')
                  }
                </p>
              </div>
              <Button
                id="microsoft-oauth-btn"
                type="button"
                variant="outline"
                onClick={handleOAuthAuthorization}
                disabled={!form.watch('mailbox') || oauthStatus === 'authorizing'}
              >
                {oauthStatus === 'authorizing' && (
                  <>
                    <Clock className="h-4 w-4 mr-2 animate-spin" />
                    {t('microsoftForm.oauth.connecting')}
                  </>
                )}
                {oauthStatus === 'success' && (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    {t('microsoftForm.oauth.connected')}
                  </>
                )}
                {(oauthStatus === 'idle' || oauthStatus === 'error') && t('microsoftForm.oauth.connectButton')}
              </Button>
            </div>
          </div>

          {/* Next Step Indicator */}
          {oauthStatus === 'success' && (
            <Alert variant="warning" showIcon={false}>
              <AlertDescription>
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 bg-warning/20 rounded-full flex items-center justify-center">
                        <span className="text-warning font-semibold">2</span>
                      </div>
                    </div>
                    <div className="ml-3">
                      <h4 className="font-medium">{t('microsoftForm.nextStep.title')}</h4>
                      <p className="text-sm">
                        {autoSubmitCountdown !== null ? (
                          <>{t('microsoftForm.nextStep.autoSubmit')} <strong>{autoSubmitCountdown}</strong> {t('microsoftForm.nextStep.secondsSuffix')} "<strong>{isEditing ? t('microsoftForm.buttons.updateProvider') : t('microsoftForm.buttons.addProvider')}</strong>" {t('microsoftForm.nextStep.clickNow')}</>
                        ) : (
                          <>{t('microsoftForm.nextStep.manualInstruction')} "<strong>{isEditing ? t('microsoftForm.buttons.updateProvider') : t('microsoftForm.buttons.addProvider')}</strong>" {t('microsoftForm.nextStep.manualSuffix')}</>
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
                      {t('microsoftForm.nextStep.cancelAutoSubmit')}
                    </Button>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Processing Settings */}
      <Card>
        <CardHeader>
          <CardTitle>{t('microsoftForm.sections.processing.title')}</CardTitle>
          <CardDescription>
            {t('microsoftForm.sections.processing.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="folderFilters">{t('microsoftForm.fields.foldersLabel')}</Label>
              <Input
                id="folderFilters"
                {...form.register('folderFilters')}
                placeholder={t('microsoftForm.fields.foldersPlaceholder')}
              />
              <p className="text-xs text-muted-foreground">
                {t('microsoftForm.fields.foldersHelp')}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxEmailsPerSync">{t('microsoftForm.fields.maxEmailsLabel')}</Label>
              <Input
                id="maxEmailsPerSync"
                type="number"
                {...form.register('maxEmailsPerSync', { valueAsNumber: true })}
                min="1"
                max="1000"
              />
              <p className="text-xs text-muted-foreground">
                {t('microsoftForm.fields.maxEmailsHelp')}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Ticket Defaults selection */}
      <Card>
        <CardHeader>
          <CardTitle>{t('microsoftForm.sections.ticketDefaults.title')}</CardTitle>
          <CardDescription>
            {t('microsoftForm.sections.ticketDefaults.description')}
            <Button
              id="manage-defaults-link"
              type="button"
              variant="link"
              className="ml-2 p-0 h-auto"
              onClick={() => window.dispatchEvent(new CustomEvent('open-defaults-tab'))}
            >
              {t('microsoftForm.buttons.manageDefaults')}
            </Button>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CustomSelect
            id="ee-microsoft-inbound-defaults-select"
            label={t('microsoftForm.fields.inboundDefaultsLabel')}
            value={(form.watch('inboundTicketDefaultsId') as any) || ''}
            onValueChange={(v) => form.setValue('inboundTicketDefaultsId', v || undefined)}
            options={defaultsOptions}
            placeholder={t('microsoftForm.fields.inboundDefaultsPlaceholder')}
            allowClear
          />
          <div className="text-right">
            <Button id="refresh-defaults-list" type="button" variant="outline" size="sm" onClick={() => window.dispatchEvent(new CustomEvent('inbound-defaults-updated'))}>
              {t('microsoftForm.buttons.refreshList')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Error Display */}
      {hasAttemptedSubmit && Object.keys(form.formState.errors).length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <p className="font-medium mb-2">{t('microsoftForm.validation.requiredFieldsTitle')}</p>
            <ul className="list-disc list-inside space-y-1">
              {form.formState.errors.providerName && <li>{t('microsoftForm.validation.providerName')}</li>}
              {form.formState.errors.mailbox && <li>{t('microsoftForm.validation.mailbox')}</li>}
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
        <Alert variant="warning">
          <AlertDescription>
            <h4 className="font-medium">{t('microsoftForm.oauth.requiredTitle')}</h4>
            <p className="text-sm">
              {isEditing ? t('microsoftForm.oauth.requiredDescriptionUpdate') : t('microsoftForm.oauth.requiredDescriptionAdd')}
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* Form Actions */}
      <div className="flex items-center justify-end space-x-2">
        <Button id="microsoft-cancel-btn" type="button" variant="outline" onClick={onCancel}>
          {t('microsoftForm.buttons.cancel')}
        </Button>
        <Button
          id="microsoft-submit-btn"
          type="submit"
          disabled={loading}
          className={`${Object.keys(form.formState.errors).length > 0 && !loading ? 'opacity-50' : ''} ${
            oauthStatus === 'success' ? 'bg-green-600 hover:bg-green-700 animate-pulse' : ''
          }`}
        >
          {loading ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              {t('microsoftForm.buttons.settingUp')}
            </>
          ) : (
            <>
              {isEditing ? t('microsoftForm.buttons.updateProvider') : t('microsoftForm.buttons.addProvider')}
              {oauthStatus === 'success' && ` ${t('microsoftForm.buttons.completeSetupSuffix')}`}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
