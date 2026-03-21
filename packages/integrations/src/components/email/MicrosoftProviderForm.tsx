/**
 * Microsoft Provider Configuration Form
 * Form for setting up Microsoft 365/Exchange Online email integration
 */

'use client';

import React, { useState } from 'react';
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
import { ExternalLink, CheckCircle } from 'lucide-react';
import type { EmailProvider } from './types';
import {
  createEmailProvider,
  updateEmailProvider,
  upsertEmailProvider,
  getMicrosoftConsumerSetupStatus,
  initiateEmailOAuth,
} from '@alga-psa/integrations/actions';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { getInboundTicketDefaults } from '@alga-psa/integrations/actions';

type MicrosoftProviderFormData = {
  providerName: string;
  mailbox: string;
  redirectUri: string;
  isActive: boolean;
  autoProcessEmails: boolean;
  folderFilters?: string;
  maxEmailsPerSync: number;
  inboundTicketDefaultsId?: string;
};

interface MicrosoftProviderFormProps {
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
}: MicrosoftProviderFormProps) {
  const { t } = useTranslation('msp/email-providers');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerSetupReady, setProviderSetupReady] = useState(false);
  const [providerSetupLoading, setProviderSetupLoading] = useState(true);
  const [providerSetupMessage, setProviderSetupMessage] = useState<string | null>(null);
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'authorizing' | 'success' | 'error'>('idle');
  const [oauthMessageReceived, setOauthMessageReceived] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [defaultsOptions, setDefaultsOptions] = useState<{ value: string; label: string }[]>([]);

  const isEditing = !!provider;

  const microsoftProviderSchema = z.object({
    providerName: z.string().min(1, t('forms.microsoft.validation.providerNameRequired', { defaultValue: 'Provider name is required' })),
    mailbox: z.string().email(t('forms.microsoft.validation.emailRequired', { defaultValue: 'Valid email address is required' })),
    redirectUri: z.string().url(t('forms.microsoft.validation.redirectRequired', { defaultValue: 'Valid redirect URI is required' })),
    isActive: z.boolean(),
    autoProcessEmails: z.boolean(),
    folderFilters: z.string().optional(),
    maxEmailsPerSync: z.number().min(1).max(1000),
    inboundTicketDefaultsId: z.string().uuid().optional()
  });

  const form = useForm<MicrosoftProviderFormData>({
    resolver: zodResolver(microsoftProviderSchema) as any,
    defaultValues: provider && provider.microsoftConfig ? {
      providerName: provider.providerName,
      mailbox: provider.mailbox,
      redirectUri: provider.microsoftConfig.redirect_uri,
      isActive: provider.isActive,
      autoProcessEmails: provider.microsoftConfig.auto_process_emails ?? true,
      folderFilters: provider.microsoftConfig.folder_filters?.join(', ') || '',
      maxEmailsPerSync: provider.microsoftConfig.max_emails_per_sync ?? 50,
      inboundTicketDefaultsId: (provider as any).inboundTicketDefaultsId || undefined
    } : {
      redirectUri: `${window.location.origin}/api/auth/microsoft/callback`,
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
    window.addEventListener('inbound-defaults-updated', onUpdate as any);
    return () => window.removeEventListener('inbound-defaults-updated', onUpdate as any);
  }, []);

  React.useEffect(() => {
    const loadProviderSetupStatus = async () => {
      try {
        const res = await getMicrosoftConsumerSetupStatus('email');
        setProviderSetupReady(Boolean(res.success && res.ready));
        setProviderSetupMessage(res.success ? res.message || null : null);
      } catch {
        setProviderSetupReady(false);
        setProviderSetupMessage(null);
      } finally {
        setProviderSetupLoading(false);
      }
    };
    loadProviderSetupStatus();
  }, []);

  

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
        mailbox: data.mailbox,
        isActive: data.isActive,
        inboundTicketDefaultsId: data.inboundTicketDefaultsId,
        microsoftConfig: {
          client_id: '',
          client_secret: '',
          tenant_id: '',
          redirect_uri: data.redirectUri,
          auto_process_emails: data.autoProcessEmails,
          folder_filters: data.folderFilters ? data.folderFilters.split(',').map(f => f.trim()) : ['Inbox'],
          max_emails_per_sync: data.maxEmailsPerSync
        }

      }

      const result = isEditing 
        ? await updateEmailProvider(provider.id, payload)
        : await createEmailProvider(payload);

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
          mailbox: formData.mailbox,
          isActive: formData.isActive,
          inboundTicketDefaultsId: (form.getValues() as any).inboundTicketDefaultsId || undefined,
          microsoftConfig: {
            client_id: '',
            client_secret: '',
            tenant_id: '',
            redirect_uri: formData.redirectUri,
            auto_process_emails: formData.autoProcessEmails,
            folder_filters: formData.folderFilters && formData.folderFilters.trim() ? formData.folderFilters.split(',').map(f => f.trim()) : ['INBOX'],
            max_emails_per_sync: formData.maxEmailsPerSync
          }
        };

        const result = await upsertEmailProvider(payload);
        providerId = result.provider.id;
      }

      // Get OAuth URL via server action
      const oauthInit = await initiateEmailOAuth({
        provider: 'microsoft',
        redirectUri: formData.redirectUri,
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

      // Monitor popup for completion
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          if (oauthStatus === 'authorizing' && !oauthMessageReceived) {
            setOauthStatus('error');
            setError(t('forms.microsoft.validation.closedEarly', { defaultValue: 'Authorization window closed before completing. Please try again.' }));
          }
        }
      }, 1000);

      // Listen for OAuth callback
      const messageHandler = (event: MessageEvent) => {
        // Validate message is from our callback
        if (event.data.type === 'oauth-callback' && event.data.provider === 'microsoft') {
          clearInterval(checkClosed);
          popup?.close();
          setOauthMessageReceived(true);
          
          if (event.data.success) {
            setOauthStatus('success');
          } else {
            setOauthStatus('error');
            setError(event.data.errorDescription || event.data.error || t('forms.microsoft.validation.authorizationFailed', { defaultValue: 'Authorization failed' }));
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
      {/* Error Display (moved to top for visibility) */}
      {hasAttemptedSubmit && Object.keys(form.formState.errors).length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <p className="font-medium mb-2">{t('forms.common.validation.requiredFieldsTitle', { defaultValue: 'Please fill in the required fields:' })}</p>
            <ul className="list-disc list-inside space-y-1">
              {form.formState.errors.providerName && <li>{t('forms.microsoft.requiredFields.providerName', { defaultValue: 'Provider Name' })}</li>}
              {form.formState.errors.mailbox && <li>{t('forms.microsoft.requiredFields.emailAddress', { defaultValue: 'Email Address' })}</li>}
              {form.formState.errors.redirectUri && <li>{t('forms.microsoft.requiredFields.redirectUri', { defaultValue: 'Redirect URI' })}</li>}
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
            {t('forms.microsoft.basic.description', { defaultValue: 'Basic settings for your Microsoft 365 email provider' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="providerName">{t('forms.microsoft.basic.providerNameLabel', { defaultValue: 'Provider Name *' })}</Label>
              <Input
                id="providerName"
                {...form.register('providerName')}
                placeholder={t('forms.microsoft.basic.providerNamePlaceholder', { defaultValue: 'e.g., Support Email' })}
                className={hasAttemptedSubmit && form.formState.errors.providerName ? 'border-red-500' : ''}
              />
              {form.formState.errors.providerName && (
                <p className="text-sm text-red-500">{form.formState.errors.providerName.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="mailbox">{t('forms.microsoft.basic.emailLabel', { defaultValue: 'Email Address *' })}</Label>
              <Input
                id="mailbox"
                type="email"
                {...form.register('mailbox')}
                placeholder={t('forms.microsoft.basic.emailPlaceholder', { defaultValue: 'support@client.com' })}
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

      {/* Microsoft OAuth Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>{t('forms.microsoft.oauth.sectionTitle', { defaultValue: 'Microsoft OAuth Configuration' })}</CardTitle>
          <CardDescription>
            {t('forms.microsoft.oauth.sectionDescription', { defaultValue: 'Microsoft app credentials are configured in Providers settings and reused here.' })}
            <Button 
              id="azure-portal-link"
              type="button" 
              variant="link" 
              className="p-0 h-auto ml-2"
              onClick={() => window.open('https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade', '_blank')}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              {t('forms.microsoft.oauth.setupLabel', { defaultValue: 'Microsoft Entra' })}
            </Button>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!providerSetupLoading && !providerSetupReady && (
            <Alert>
              <AlertDescription>
                <div className="space-y-2">
                  <div className="font-medium">{t('forms.microsoft.oauth.notConfigured', { defaultValue: 'Microsoft provider settings are not configured.' })}</div>
                  <div className="text-sm text-muted-foreground">
                    {providerSetupMessage ||
                      t('forms.microsoft.oauth.setupHelp', { defaultValue: 'Configure Providers first in Settings → Integrations → Providers, then return here to authorize this mailbox.' })}
                  </div>
                  <Button
                    id="configure-microsoft-providers-link"
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => window.location.assign('/msp/settings?category=providers')}
                  >
                    {t('forms.common.actions.openProvidersSettings', { defaultValue: 'Open Providers Settings' })}
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="redirectUri">{t('forms.microsoft.oauth.redirectUriLabel', { defaultValue: 'Redirect URI *' })}</Label>
            <Input
              id="redirectUri"
              {...form.register('redirectUri')}
              placeholder={t('forms.microsoft.oauth.redirectUriPlaceholder', { defaultValue: 'https://yourapp.com/api/auth/microsoft/callback' })}
              className={hasAttemptedSubmit && form.formState.errors.redirectUri ? 'border-red-500' : ''}
            />
            {form.formState.errors.redirectUri && (
              <p className="text-sm text-red-500">{form.formState.errors.redirectUri.message}</p>
            )}
          </div>

          {/* OAuth Authorization */}
          <div className="bg-muted/50 p-4 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">{t('forms.microsoft.oauth.authorizationTitle', { defaultValue: 'OAuth Authorization' })}</h4>
                <p className="text-sm text-muted-foreground">
                  {t('forms.microsoft.oauth.authorizationDescription', { defaultValue: 'Complete OAuth flow to grant access to the mailbox' })}
                </p>
              </div>
              <Button
                id="oauth-authorize-btn"
                type="button"
                variant="outline"
                onClick={handleOAuthAuthorization}
                disabled={!providerSetupReady || !form.watch('redirectUri') || oauthStatus === 'authorizing'}
              >
                {oauthStatus === 'authorizing' && t('forms.common.oauth.authorizing', { defaultValue: 'Authorizing...' })}
                {oauthStatus === 'success' && <><CheckCircle className="h-4 w-4 mr-2" />{t('forms.common.oauth.authorized', { defaultValue: 'Authorized' })}</>}
                {(oauthStatus === 'idle' || oauthStatus === 'error') && t('forms.common.oauth.authorizeAccess', { defaultValue: 'Authorize Access' })}
              </Button>
            </div>
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
          <div className="grid grid-cols-2 gap-4">
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
