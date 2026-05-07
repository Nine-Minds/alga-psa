/**
 * IMAP Provider Configuration Form
 * Form for setting up IMAP inbound email integration
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
import { Eye, EyeOff } from 'lucide-react';
import type { EmailProvider } from './types';
import { createEmailProvider, updateEmailProvider } from '@alga-psa/integrations/actions';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { getInboundTicketDefaults } from '@alga-psa/integrations/actions';

type ImapProviderFormData = {
  providerName: string;
  senderDisplayName?: string;
  mailbox: string;
  host: string;
  port: number;
  secure: boolean;
  allowStarttls: boolean;
  authType: 'password' | 'oauth2';
  username: string;
  password?: string;
  oauthAuthorizeUrl?: string;
  oauthTokenUrl?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthScopes?: string;
  isActive: boolean;
  folderFilters?: string;
  inboundTicketDefaultsId?: string;
};

interface ImapProviderFormProps {
  tenant: string;
  provider?: EmailProvider;
  onSuccess: (provider: EmailProvider) => void;
  onCancel: () => void;
}

export function ImapProviderForm({
  tenant,
  provider,
  onSuccess,
  onCancel
}: ImapProviderFormProps) {
  const { t } = useTranslation('msp/email-providers');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [defaultsOptions, setDefaultsOptions] = useState<{ value: string; label: string }[]>([]);
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'authorizing' | 'error'>('idle');

  const isEditing = !!provider;

  const imapProviderSchema = z.object({
    providerName: z.string().min(1, t('forms.imap.validation.providerNameRequired', { defaultValue: 'Configuration name is required' })),
    senderDisplayName: z
      .string()
      .max(255)
      .refine((value) => !/[\x00-\x1F\x7F"<>]/.test(value), {
        message: t('forms.imap.validation.senderDisplayNameInvalid', {
          defaultValue: 'Display name cannot contain quotes, angle brackets, or line breaks',
        }),
      })
      .optional(),
    mailbox: z
      .string()
      .trim()
      .min(1, t('forms.imap.validation.mailboxRequired', { defaultValue: 'Mailbox is required' }))
      .refine((value) => {
        const lower = value.toLowerCase();
        const isLocalPartOnly = /^[^\s@]+$/.test(lower);
        const isEmailLike = /^[^\s@]+@[^\s@]+$/.test(lower);
        return isLocalPartOnly || isEmailLike;
      }, t('forms.imap.validation.mailboxInvalid', { defaultValue: 'Valid mailbox is required (e.g. user@domain.com, user@localhost, user@test-server, or user)' })),
    host: z.string().min(1, t('forms.imap.validation.hostRequired', { defaultValue: 'IMAP host is required' })),
    port: z.number().min(1).max(65535),
    secure: z.boolean(),
    allowStarttls: z.boolean(),
    authType: z.enum(['password', 'oauth2']),
    username: z.string().min(1, t('forms.imap.validation.usernameRequired', { defaultValue: 'IMAP username is required' })),
    password: z.string().optional(),
    oauthAuthorizeUrl: z.string().optional(),
    oauthTokenUrl: z.string().optional(),
    oauthClientId: z.string().optional(),
    oauthClientSecret: z.string().optional(),
    oauthScopes: z.string().optional(),
    isActive: z.boolean(),
    folderFilters: z.string().optional(),
    inboundTicketDefaultsId: z.string().uuid().optional()
  });

  const form = useForm<ImapProviderFormData>({
    resolver: zodResolver(imapProviderSchema) as any,
    defaultValues: provider && provider.imapConfig ? {
      providerName: provider.providerName,
      senderDisplayName: provider.senderDisplayName || '',
      mailbox: provider.mailbox,
      host: provider.imapConfig.host,
      port: provider.imapConfig.port,
      secure: provider.imapConfig.secure,
      allowStarttls: provider.imapConfig.allow_starttls,
      authType: provider.imapConfig.auth_type,
      username: provider.imapConfig.username,
      password: '',
      oauthAuthorizeUrl: provider.imapConfig.oauth_authorize_url || '',
      oauthTokenUrl: provider.imapConfig.oauth_token_url || '',
      oauthClientId: provider.imapConfig.oauth_client_id || '',
      oauthClientSecret: provider.imapConfig.oauth_client_secret || '',
      oauthScopes: provider.imapConfig.oauth_scopes || '',
      isActive: provider.isActive,
      folderFilters: provider.imapConfig.folder_filters?.join(', ') || '',
      inboundTicketDefaultsId: (provider as any).inboundTicketDefaultsId || undefined
    } : {
      senderDisplayName: '',
      port: 993,
      secure: true,
      allowStarttls: false,
      authType: 'password',
      isActive: true,
      folderFilters: '',
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

  const onSubmit = async (data: ImapProviderFormData) => {
    setHasAttemptedSubmit(true);
    const isValid = await form.trigger();
    if (!isValid) return;

    try {
      setLoading(true);
      setError(null);

      const payload = {
        tenant,
        providerType: 'imap',
        providerName: data.providerName,
        senderDisplayName: data.senderDisplayName?.trim() || null,
        mailbox: data.mailbox,
        isActive: data.isActive,
        inboundTicketDefaultsId: (form.getValues() as any).inboundTicketDefaultsId || undefined,
        imapConfig: {
          host: data.host,
          port: data.port,
          secure: data.secure,
          allow_starttls: data.allowStarttls,
          auth_type: data.authType,
          username: data.username,
          password: data.password || undefined,
          oauth_authorize_url: data.oauthAuthorizeUrl || undefined,
          oauth_token_url: data.oauthTokenUrl || undefined,
          oauth_client_id: data.oauthClientId || undefined,
          oauth_client_secret: data.oauthClientSecret || undefined,
          oauth_scopes: data.oauthScopes || undefined,
          auto_process_emails: true,
          folder_filters: data.folderFilters ? data.folderFilters.split(',').map(f => f.trim()).filter(Boolean) : [],
          // Not exposed in UI (configured via env / defaults)
          max_emails_per_sync: 5,
          connection_timeout_ms: 10_000,
          socket_keepalive: true,
        }
      };

      const result = isEditing
        ? await updateEmailProvider(provider.id, payload, true)
        : await createEmailProvider(payload, true);

      onSuccess(result.provider);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const authType = form.watch('authType');
  const oauthConnected = !!provider?.imapConfig?.refresh_token || !!provider?.imapConfig?.access_token;

  const handleOauthConnect = async () => {
    if (!provider?.id) return;
    try {
      setOauthStatus('authorizing');
      const response = await fetch('/api/email/oauth/imap/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: provider.id }),
      });
      const result = await response.json();
      if (!response.ok || !result.authUrl) {
        throw new Error(result.error || t('forms.imap.validation.oauthInitiateFailed', { defaultValue: 'Failed to initiate IMAP OAuth' }));
      }
      window.open(result.authUrl, '_blank', 'width=600,height=700');
      setOauthStatus('idle');
    } catch (err) {
      console.error(err);
      setOauthStatus('error');
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit, (errors) => { console.error('Form validation errors:', errors); setHasAttemptedSubmit(true); })} className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('forms.imap.basic.title', { defaultValue: 'Basic Settings' })}</CardTitle>
          <CardDescription>{t('forms.imap.basic.description', { defaultValue: 'Define the IMAP mailbox connection details.' })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="providerName">{t('forms.imap.basic.providerName', { defaultValue: 'Configuration Name' })}</Label>
            <Input
              id="providerName"
              {...form.register('providerName')}
              placeholder={t('forms.imap.basic.providerNamePlaceholder', { defaultValue: 'e.g., Support IMAP (internal)' })}
              error={form.formState.errors.providerName?.message}
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t('forms.imap.basic.providerNameHelp', { defaultValue: 'Internal name used to identify this configuration. Not shown in outbound emails.' })}
            </p>
          </div>
          <div>
            <Label htmlFor="senderDisplayName">{t('forms.imap.basic.senderDisplayName', { defaultValue: 'Sender Display Name' })}</Label>
            <Input
              id="senderDisplayName"
              {...form.register('senderDisplayName')}
              placeholder={t('forms.imap.basic.senderDisplayNamePlaceholder', { defaultValue: 'e.g., Acme Support' })}
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t('forms.imap.basic.senderDisplayNameHelp', { defaultValue: 'Display name shown in the From header on outbound ticket emails (replies, closures). Applied only when this mailbox matches the tenant\'s outbound ticketing-from address. Leave blank to fall back to the ticket\'s board name.' })}
            </p>
          </div>
          <div>
            <Label htmlFor="mailbox">{t('forms.imap.basic.mailboxAddress', { defaultValue: 'Mailbox Address' })}</Label>
            <Input id="mailbox" type="email" {...form.register('mailbox')} error={form.formState.errors.mailbox?.message} />
          </div>
          <div>
            <Label htmlFor="host">{t('forms.imap.basic.host', { defaultValue: 'IMAP Host' })}</Label>
            <Input id="host" {...form.register('host')} error={form.formState.errors.host?.message} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="port">{t('forms.imap.basic.port', { defaultValue: 'Port' })}</Label>
              <Input
                id="port"
                type="number"
                {...form.register('port', { valueAsNumber: true })}
              />
            </div>
            <div className="flex items-center justify-between pt-6">
              <Label htmlFor="secure">{t('forms.imap.basic.useTls', { defaultValue: 'Use TLS/SSL' })}</Label>
              <Switch id="secure" checked={form.watch('secure')} onCheckedChange={(v) => form.setValue('secure', v)} />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="allowStarttls">{t('forms.imap.basic.allowStarttls', { defaultValue: 'Allow STARTTLS Upgrade' })}</Label>
            <Switch id="allowStarttls" checked={form.watch('allowStarttls')} onCheckedChange={(v) => form.setValue('allowStarttls', v)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('forms.imap.auth.title', { defaultValue: 'Authentication' })}</CardTitle>
          <CardDescription>{t('forms.imap.auth.description', { defaultValue: 'Choose password or OAuth2 authentication.' })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>{t('forms.imap.auth.typeLabel', { defaultValue: 'Authentication Type' })}</Label>
            <CustomSelect
              id="imap-auth-type"
              value={authType}
              onValueChange={(v) => form.setValue('authType', v as 'password' | 'oauth2')}
              options={[
                { value: 'password', label: t('forms.imap.auth.passwordOption', { defaultValue: 'Password' }) },
                { value: 'oauth2', label: t('forms.imap.auth.oauth2Option', { defaultValue: 'OAuth2 (XOAUTH2)' }) }
              ]}
            />
          </div>
          <div>
            <Label htmlFor="username">{t('forms.imap.auth.username', { defaultValue: 'Username' })}</Label>
            <Input id="username" {...form.register('username')} error={form.formState.errors.username?.message} />
          </div>

          {authType === 'password' && (
            <div>
              <Label htmlFor="password">{t('forms.imap.auth.password', { defaultValue: 'Password / App Password' })}</Label>
              {isEditing && (
                <p className="text-xs text-muted-foreground mt-1">
                  {t('forms.imap.auth.passwordHelp', { defaultValue: 'Passwords are stored securely and will not be displayed. Leave blank to keep the existing password.' })}
                </p>
              )}
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  {...form.register('password')} error={form.formState.errors.password?.message}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-2 flex items-center text-gray-500"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}

          {authType === 'oauth2' && (
            <div className="space-y-4">
              {provider && (
                <div className="flex items-center justify-between rounded border border-gray-200 p-3 text-sm">
                  <div>
                    <p className="font-medium">{t('forms.imap.auth.oauthStatus', { defaultValue: 'OAuth Status' })}</p>
                    <p className="text-muted-foreground">{oauthConnected ? t('forms.imap.auth.connected', { defaultValue: 'Connected' }) : t('forms.imap.auth.notConnected', { defaultValue: 'Not connected' })}</p>
                  </div>
                  <Button id="imap-oauth-reconnect-btn" type="button" variant="outline" onClick={handleOauthConnect} disabled={oauthStatus === 'authorizing'}>
                    {oauthStatus === 'authorizing'
                      ? t('forms.common.oauth.authorizing', { defaultValue: 'Authorizing...' })
                      : t('forms.imap.auth.reconnectOauth', { defaultValue: 'Reconnect OAuth' })}
                  </Button>
                </div>
              )}
              <div>
                <Label htmlFor="oauthAuthorizeUrl">{t('forms.imap.auth.authorizeUrl', { defaultValue: 'Authorize URL' })}</Label>
                <Input id="oauthAuthorizeUrl" {...form.register('oauthAuthorizeUrl')} error={form.formState.errors.oauthAuthorizeUrl?.message} />
              </div>
              <div>
                <Label htmlFor="oauthTokenUrl">{t('forms.imap.auth.tokenUrl', { defaultValue: 'Token URL' })}</Label>
                <Input id="oauthTokenUrl" {...form.register('oauthTokenUrl')} error={form.formState.errors.oauthTokenUrl?.message} />
              </div>
              <div>
                <Label htmlFor="oauthClientId">{t('forms.imap.auth.clientId', { defaultValue: 'OAuth Client ID' })}</Label>
                <Input id="oauthClientId" {...form.register('oauthClientId')} error={form.formState.errors.oauthClientId?.message} />
              </div>
              <div>
                <Label htmlFor="oauthClientSecret">{t('forms.imap.auth.clientSecret', { defaultValue: 'OAuth Client Secret' })}</Label>
                <div className="relative">
                  <Input
                    id="oauthClientSecret"
                    type={showClientSecret ? 'text' : 'password'}
                    {...form.register('oauthClientSecret')} error={form.formState.errors.oauthClientSecret?.message}
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-2 flex items-center text-gray-500"
                    onClick={() => setShowClientSecret(!showClientSecret)}
                  >
                    {showClientSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <Label htmlFor="oauthScopes">{t('forms.imap.auth.scopes', { defaultValue: 'OAuth Scopes' })}</Label>
                <Input id="oauthScopes" {...form.register('oauthScopes')} error={form.formState.errors.oauthScopes?.message} placeholder={t('forms.imap.auth.scopesPlaceholder', { defaultValue: 'space-delimited scopes' })} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('forms.imap.processing.title', { defaultValue: 'Processing Settings' })}</CardTitle>
          <CardDescription>{t('forms.imap.processing.description', { defaultValue: 'Choose folders and processing behavior.' })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="folderFilters">{t('forms.imap.processing.folderFilters', { defaultValue: 'Folder Filters' })}</Label>
            <Input id="folderFilters" {...form.register('folderFilters')} error={form.formState.errors.folderFilters?.message} placeholder={t('forms.imap.processing.folderFiltersPlaceholder', { defaultValue: 'Inbox, Support, Tickets' })} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="isActive">{t('forms.imap.processing.active', { defaultValue: 'Active' })}</Label>
            <Switch id="isActive" checked={form.watch('isActive')} onCheckedChange={(v) => form.setValue('isActive', v)} />
          </div>
          <CustomSelect
            id="imap-defaults-select"
            label={t('forms.common.ticketDefaults.title', { defaultValue: 'Ticket Defaults' })}
            value={form.watch('inboundTicketDefaultsId') || ''}
            onValueChange={(v) => form.setValue('inboundTicketDefaultsId', v || undefined)}
            options={defaultsOptions}
            placeholder={defaultsOptions.length
              ? t('forms.common.ticketDefaults.placeholder', { defaultValue: 'Select defaults (optional)' })
              : t('forms.common.ticketDefaults.empty', { defaultValue: 'No defaults available' })}
            allowClear
          />
        </CardContent>
      </Card>

      {hasAttemptedSubmit && Object.keys(form.formState.errors).length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>{t('forms.common.validation.fixHighlightedFields', { defaultValue: 'Please fix the highlighted fields and try again.' })}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end space-x-3">
        <Button id="imap-provider-cancel-btn" type="button" variant="outline" onClick={onCancel} disabled={loading}>
          {t('forms.common.actions.cancel', { defaultValue: 'Cancel' })}
        </Button>
        <Button id="imap-provider-submit-btn" type="submit" disabled={loading}>
          {loading
            ? t('forms.common.actions.saving', { defaultValue: 'Saving...' })
            : isEditing
            ? t('forms.common.actions.updateProvider', { defaultValue: 'Update Provider' })
            : t('forms.common.actions.createProvider', { defaultValue: 'Create Provider' })}
        </Button>
      </div>
    </form>
  );
}
