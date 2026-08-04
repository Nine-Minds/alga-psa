/**
 * Microsoft Provider Configuration Form
 * Form for setting up Microsoft 365/Exchange Online email integration
 */

'use client';

import React, { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { CheckCircle } from 'lucide-react';
import type { EmailProvider } from './types';
import {
  createEmailProvider,
  updateEmailProvider,
  upsertEmailProvider,
  initiateEmailOAuth,
} from '@alga-psa/integrations/actions';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { getInboundTicketDefaults } from '@alga-psa/integrations/actions';
import {
  getErrorMessage,
  isActionMessageError,
} from '@alga-psa/ui/lib/errorHandling';
import type { MicrosoftEmailSetupReadiness } from '../../actions/integrations/providerReadiness';

type MicrosoftProviderFormData = {
  providerName: string;
  senderDisplayName?: string;
  mailbox: string;
  isActive: boolean;
  autoProcessEmails: boolean;
  folderFilters?: string;
  maxEmailsPerSync: number;
  inboundTicketDefaultsId?: string;
};

export interface MicrosoftProviderFormProps {
  tenant: string;
  provider?: EmailProvider;
  onSuccess: (provider: EmailProvider) => void;
  onCancel: () => void;
  emailSetup?: MicrosoftEmailSetupReadiness | null;
}

export function MicrosoftProviderForm({ 
  tenant,
  provider, 
  onSuccess, 
  onCancel,
  emailSetup,
}: MicrosoftProviderFormProps) {
  const { t } = useTranslation('msp/email-providers');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'authorizing' | 'success' | 'error'>('idle');
  const oauthCompletedRef = useRef(false);
  const oauthCleanupRef = useRef<(() => void) | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [defaultsOptions, setDefaultsOptions] = useState<{ value: string; label: string }[]>([]);

  const isEditing = !!provider;
  const providerSetupReady = emailSetup?.state === 'ready';

  const microsoftProviderSchema = z.object({
    providerName: z.string().min(1, t('forms.microsoft.validation.providerNameRequired', { defaultValue: 'Configuration name is required' })),
    senderDisplayName: z
      .string()
      .max(255)
      .refine((value) => !/[\x00-\x1F\x7F"<>]/.test(value), {
        message: t('forms.microsoft.validation.senderDisplayNameInvalid', {
          defaultValue: 'Display name cannot contain quotes, angle brackets, or line breaks',
        }),
      })
      .optional(),
    mailbox: z.string().email(t('forms.microsoft.validation.emailRequired', { defaultValue: 'Valid email address is required' })),
    isActive: z.boolean(),
    autoProcessEmails: z.boolean(),
    folderFilters: z.string().optional(),
    maxEmailsPerSync: z.number().min(1).max(1000),
    inboundTicketDefaultsId: z.string().uuid().optional()
  });

  const form = useForm<MicrosoftProviderFormData>({
    resolver: zodResolver(microsoftProviderSchema),
    defaultValues: provider && provider.microsoftConfig ? {
      providerName: provider.providerName,
      senderDisplayName: provider.senderDisplayName || '',
      mailbox: provider.mailbox,
      isActive: provider.isActive,
      autoProcessEmails: provider.microsoftConfig.auto_process_emails ?? true,
      folderFilters: provider.microsoftConfig.folder_filters?.join(', ') || '',
      maxEmailsPerSync: provider.microsoftConfig.max_emails_per_sync ?? 50,
      inboundTicketDefaultsId: provider.inboundTicketDefaultsId || undefined
    } : {
      senderDisplayName: '',
      isActive: true,
      autoProcessEmails: true,
      folderFilters: '',
      maxEmailsPerSync: 50,
      inboundTicketDefaultsId: undefined
    }
  });

  // Load inbound ticket defaults options
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
    window.addEventListener('inbound-defaults-updated', onUpdate);
    return () => window.removeEventListener('inbound-defaults-updated', onUpdate);
  }, []);

  React.useEffect(() => () => oauthCleanupRef.current?.(), []);

  

  const onSubmit = async (data: MicrosoftProviderFormData) => {
    setHasAttemptedSubmit(true);
    
    // Check if form is valid
    const isValid = await form.trigger();
    if (!isValid) {
      return;
    }
    
    try {
      setLoading(true);
      setError(null);

      const payload = {
        tenant,
        providerType: 'microsoft',
        providerName: data.providerName,
        senderDisplayName: data.senderDisplayName?.trim() || null,
        mailbox: data.mailbox,
        isActive: data.isActive,
        inboundTicketDefaultsId: data.inboundTicketDefaultsId,
        microsoftConfig: {
          client_id: '',
          client_secret: '',
          tenant_id: '',
          auto_process_emails: data.autoProcessEmails,
          folder_filters: data.folderFilters ? data.folderFilters.split(',').map(f => f.trim()) : ['Inbox'],
          max_emails_per_sync: data.maxEmailsPerSync
        }

      }

      const result = isEditing 
        ? await updateEmailProvider(provider.id, payload)
        : await createEmailProvider(payload);

      if (isActionMessageError(result)) {
        setError(getErrorMessage(result));
        return;
      }

      onSuccess(result.provider);

    } catch (err: any) {
      setError(getErrorMessage(err));
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
        setError(t('forms.microsoft.validation.authorizeRequiresValid', { defaultValue: 'Please fill in all required fields before authorizing' }));
        return;
      }

      // Save provider first so credentials are available for OAuth
      let providerId = provider?.id;
      if (!providerId) {
        const payload = {
          tenant,
          providerType: 'microsoft',
          providerName: formData.providerName,
          senderDisplayName: formData.senderDisplayName?.trim() || null,
          mailbox: formData.mailbox,
          isActive: formData.isActive,
          inboundTicketDefaultsId: formData.inboundTicketDefaultsId || undefined,
          microsoftConfig: {
            client_id: '',
            client_secret: '',
            tenant_id: '',
            auto_process_emails: formData.autoProcessEmails,
            folder_filters: formData.folderFilters && formData.folderFilters.trim() ? formData.folderFilters.split(',').map(f => f.trim()) : ['INBOX'],
            max_emails_per_sync: formData.maxEmailsPerSync
          }
        };

        const result = await upsertEmailProvider(payload);
        if (isActionMessageError(result)) {
          throw new Error(getErrorMessage(result));
        }
        providerId = result.provider.id;
      }

      // Get OAuth URL via server action
      const oauthInit = await initiateEmailOAuth({
        provider: 'microsoft',
        providerId: providerId,
      });
      if (!oauthInit.success) {
        throw new Error((oauthInit as { success: false; error: string }).error || t('forms.microsoft.validation.oauthInitiateFailed', { defaultValue: 'Failed to initiate OAuth' }));
      }
      const { authUrl } = oauthInit;

      // Open OAuth popup
      const popup = window.open(
        authUrl,
        'microsoft-oauth',
        'width=600,height=700,scrollbars=yes,resizable=yes'
      );

      if (!popup) {
        throw new Error(t('forms.microsoft.validation.popupBlocked', { defaultValue: 'Failed to open OAuth popup. Please allow popups for this site.' }));
      }

      oauthCleanupRef.current?.();
      oauthCompletedRef.current = false;

      // Monitor popup for completion
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          oauthCleanupRef.current?.();
          if (!oauthCompletedRef.current) {
            setOauthStatus('error');
            setError(t('forms.microsoft.validation.closedEarly', { defaultValue: 'Authorization window closed before completing. Please try again.' }));
          }
        }
      }, 1000);

      // Listen for OAuth callback
      const messageHandler = (event: MessageEvent) => {
        // Validate message is from our callback
        if (
          event.origin === window.location.origin &&
          event.data.type === 'oauth-callback' &&
          event.data.provider === 'microsoft'
        ) {
          oauthCompletedRef.current = true;
          oauthCleanupRef.current?.();
          popup?.close();
          
          if (event.data.success) {
            setOauthStatus('success');
          } else {
            setOauthStatus('error');
            setError(event.data.errorDescription || event.data.error || t('forms.microsoft.validation.authorizationFailed', { defaultValue: 'Authorization failed' }));
          }
          
        }
      };

      window.addEventListener('message', messageHandler);
      oauthCleanupRef.current = () => {
        clearInterval(checkClosed);
        window.removeEventListener('message', messageHandler);
        oauthCleanupRef.current = null;
      };

    } catch (err) {
      setOauthStatus('error');
      console.error('Failed to start Microsoft authorization:', err);
      setError(getErrorMessage(err));
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      {/* Error Display (moved to top for visibility) */}
      {hasAttemptedSubmit && Object.keys(form.formState.errors).length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <p className="font-medium mb-2">{t('forms.common.validation.requiredFieldsTitle', { defaultValue: 'Please fill in the required fields:' })}</p>
            <ul className="list-disc list-inside space-y-1">
              {form.formState.errors.providerName && <li>{t('forms.microsoft.requiredFields.providerName', { defaultValue: 'Configuration Name' })}</li>}
              {form.formState.errors.mailbox && <li>{t('forms.microsoft.requiredFields.emailAddress', { defaultValue: 'Email Address' })}</li>}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Basic Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>{t('forms.microsoft.basic.title', { defaultValue: 'Basic Configuration' })}</CardTitle>
          <CardDescription>
            {t('forms.microsoft.basic.description', { defaultValue: 'Connect a Microsoft 365 mailbox for inbound tickets and optional outbound sending' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="providerName">{t('forms.microsoft.basic.providerNameLabel', { defaultValue: 'Configuration Name *' })}</Label>
              <Input
                id="providerName"
                {...form.register('providerName')}
                placeholder={t('forms.microsoft.basic.providerNamePlaceholder', { defaultValue: 'e.g., Support Mailbox (internal)' })}
                className={hasAttemptedSubmit && form.formState.errors.providerName ? 'border-destructive' : ''}
              />
              <p className="text-xs text-muted-foreground">
                {t('forms.microsoft.basic.providerNameHelp', { defaultValue: 'Internal name used to identify this configuration. Not shown in outbound emails.' })}
              </p>
              {form.formState.errors.providerName && (
                <p className="text-sm text-destructive">{form.formState.errors.providerName.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="mailbox">{t('forms.microsoft.basic.emailLabel', { defaultValue: 'Email Address *' })}</Label>
              <Input
                id="mailbox"
                type="email"
                {...form.register('mailbox')}
                placeholder={t('forms.microsoft.basic.emailPlaceholder', { defaultValue: 'support@client.com' })}
                className={hasAttemptedSubmit && form.formState.errors.mailbox ? 'border-destructive' : ''}
              />
              {form.formState.errors.mailbox && (
                <p className="text-sm text-destructive">{form.formState.errors.mailbox.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="senderDisplayName">{t('forms.microsoft.basic.senderDisplayNameLabel', { defaultValue: 'Sender Display Name' })}</Label>
            <Input
              id="senderDisplayName"
              {...form.register('senderDisplayName')}
              placeholder={t('forms.microsoft.basic.senderDisplayNamePlaceholder', { defaultValue: 'e.g., Acme Support' })}
            />
            <p className="text-xs text-muted-foreground">
              {t('forms.microsoft.basic.senderDisplayNameHelp', { defaultValue: 'Display name shown in the From header on outbound ticket emails. It applies when this mailbox matches the configured outbound ticketing address. Leave blank to use the ticket board name.' })}
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="isActive"
              checked={form.watch('isActive')}
              onCheckedChange={(checked: boolean) => form.setValue('isActive', checked)}
            />
            <Label htmlFor="isActive">{t('forms.microsoft.basic.enableProvider', { defaultValue: 'Enable this provider' })}</Label>
          </div>
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
          id="microsoft-inbound-defaults-select"
          label={t('forms.common.ticketDefaults.label', { defaultValue: 'Inbound Ticket Defaults' })}
          value={form.watch('inboundTicketDefaultsId') || ''}
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

      {/* Microsoft OAuth Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>{t('forms.microsoft.hostedOauth.sectionTitle', { defaultValue: 'Connect Microsoft 365' })}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {emailSetup === undefined ? (
            <Alert variant="info">
              <AlertDescription>
                {t('forms.microsoft.readiness.checking', { defaultValue: 'Checking Microsoft setup…' })}
              </AlertDescription>
            </Alert>
          ) : emailSetup?.state === 'ready' ? (
            <Alert variant="info">
              <AlertDescription>
                {t('forms.microsoft.readiness.ready', { defaultValue: 'Microsoft is set up. Sign in as this mailbox to finish.' })}
              </AlertDescription>
            </Alert>
          ) : emailSetup?.state === 'pending_admin_consent' ? (
            <Alert variant="warning">
              <AlertDescription>
                <div className="space-y-2">
                  <div>{t('forms.microsoft.readiness.pending', { defaultValue: "Waiting for your Microsoft 365 administrator. Setup was started in Providers but hasn't been approved yet." })}</div>
                  <Button
                    id="open-microsoft-providers-button"
                    type="button"
                    variant="link"
                    className="h-auto p-0"
                    onClick={() => window.location.assign('/msp/settings/integrations?category=providers')}
                  >
                    {t('forms.microsoft.readiness.openProviders', { defaultValue: 'Open Providers' })}
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="warning">
              <AlertDescription>
                <div className="space-y-2">
                  <div>{t('forms.microsoft.readiness.notConfigured', { defaultValue: "Microsoft isn't set up yet. Set it up once in Providers, then come back." })}</div>
                  <Button
                    id="set-up-microsoft-in-providers-button"
                    type="button"
                    variant="link"
                    className="h-auto p-0"
                    onClick={() => window.location.assign('/msp/settings/integrations?category=providers')}
                  >
                    {t('forms.microsoft.readiness.setUpInProviders', { defaultValue: 'Set up in Providers' })}
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex justify-end">
            <Button
              id="oauth-authorize-btn"
              type="button"
              onClick={handleOAuthAuthorization}
              disabled={!providerSetupReady || oauthStatus === 'authorizing'}
            >
              {oauthStatus === 'authorizing' && t('forms.microsoft.oauth.signingIn', { defaultValue: 'Signing in…' })}
              {oauthStatus === 'success' && <><CheckCircle className="mr-2 h-4 w-4" />{t('forms.common.oauth.authorized', { defaultValue: 'Connected' })}</>}
              {(oauthStatus === 'idle' || oauthStatus === 'error') && t('forms.microsoft.oauth.signIn', { defaultValue: 'Sign in with Microsoft' })}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Advanced Settings */}
      <Card>
        <CardHeader>
          <CardTitle>{t('forms.microsoft.advanced.title', { defaultValue: 'Advanced Settings' })}</CardTitle>
          <CardDescription>
            {t('forms.microsoft.advanced.description', { defaultValue: 'Configure advanced email processing options' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="folderFilters">{t('forms.microsoft.advanced.folderFiltersLabel', { defaultValue: 'Folder Filters' })}</Label>
              <Input
                id="folderFilters"
                {...form.register('folderFilters')}
                placeholder={t('forms.microsoft.advanced.folderFiltersPlaceholder', { defaultValue: 'Inbox, Support, Custom Folder' })}
              />
              <p className="text-xs text-muted-foreground">
                {t('forms.microsoft.advanced.folderFiltersHelp', { defaultValue: 'Comma-separated list of folders to monitor (default: Inbox)' })}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxEmailsPerSync">{t('forms.microsoft.advanced.maxEmailsPerSync', { defaultValue: 'Max Emails Per Sync' })}</Label>
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

      {/* Form Actions */}
      <div className="flex items-center justify-end space-x-2">
        <Button id="cancel-btn" type="button" variant="outline" onClick={onCancel}>
          {t('forms.common.actions.cancel', { defaultValue: 'Cancel' })}
        </Button>
        <Button 
          id="submit-btn" 
          type="submit" 
          disabled={loading}
          className={Object.keys(form.formState.errors).length > 0 && !loading ? 'opacity-50' : ''}
        >
          {loading
            ? t('forms.common.actions.saving', { defaultValue: 'Saving...' })
            : isEditing
            ? t('forms.common.actions.updateProvider', { defaultValue: 'Update Provider' })
            : t('forms.common.actions.addProvider', { defaultValue: 'Add Provider' })}
        </Button>
      </div>
    </form>
  );
}
