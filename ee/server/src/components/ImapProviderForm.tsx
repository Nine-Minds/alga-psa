/**
 * Enterprise Edition IMAP Provider Configuration Form
 */

'use client';

import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Switch } from '@/components/ui/Switch';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Eye, EyeOff } from 'lucide-react';
import type { EmailProvider } from '@/components/EmailProviderConfiguration';
import { createEmailProvider, updateEmailProvider } from '@/lib/actions/email-actions/emailProviderActions';
import CustomSelect from '@/components/ui/CustomSelect';
import { getInboundTicketDefaults } from '@/lib/actions/email-actions/inboundTicketDefaultsActions';

const eeImapProviderSchema = z.object({
  providerName: z.string().min(1, 'Provider name is required'),
  mailbox: z
    .string()
    .trim()
    .min(1, 'Mailbox is required')
    .refine((value) => {
      const lower = value.toLowerCase();
      const isLocalPartOnly = /^[^\s@]+$/.test(lower);
      const isLocalhostEmail = /^[^\s@]+@localhost$/.test(lower);
      const isStandardEmail = z.string().email().safeParse(lower).success;
      return isLocalPartOnly || isLocalhostEmail || isStandardEmail;
    }, 'Valid mailbox is required (e.g. user@domain.com, user@localhost, or user)'),
  host: z.string().min(1, 'IMAP host is required'),
  port: z.number().min(1).max(65535),
  secure: z.boolean(),
  allowStarttls: z.boolean(),
  authType: z.enum(['password', 'oauth2']),
  username: z.string().min(1, 'IMAP username is required'),
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

type EEImapProviderFormData = z.infer<typeof eeImapProviderSchema>;

interface EEImapProviderFormProps {
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
}: EEImapProviderFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [defaultsOptions, setDefaultsOptions] = useState<{ value: string; label: string }[]>([]);
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'authorizing' | 'error'>('idle');

  const isEditing = !!provider;

  const form = useForm<EEImapProviderFormData>({
    resolver: zodResolver(eeImapProviderSchema) as any,
    defaultValues: provider && provider.imapConfig ? {
      providerName: provider.providerName,
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
      port: 993,
      secure: true,
      allowStarttls: false,
      authType: 'password',
      isActive: true,
      folderFilters: '',
      inboundTicketDefaultsId: undefined
    }
  });

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

  const onSubmit = async (data: EEImapProviderFormData) => {
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
        throw new Error(result.error || 'Failed to initiate IMAP OAuth');
      }
      window.open(result.authUrl, '_blank', 'width=600,height=700');
      setOauthStatus('idle');
    } catch (err) {
      console.error(err);
      setOauthStatus('error');
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Basic Settings</CardTitle>
          <CardDescription>Define the IMAP mailbox connection details.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="providerName">Provider Name</Label>
            <Input id="providerName" {...form.register('providerName')} />
          </div>
          <div>
            <Label htmlFor="mailbox">Mailbox Address</Label>
            <Input id="mailbox" type="email" {...form.register('mailbox')} />
          </div>
          <div>
            <Label htmlFor="host">IMAP Host</Label>
            <Input id="host" {...form.register('host')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="port">Port</Label>
              <Input id="port" type="number" {...form.register('port', { valueAsNumber: true })} />
            </div>
            <div className="flex items-center justify-between pt-6">
              <Label htmlFor="secure">Use TLS/SSL</Label>
              <Switch id="secure" checked={form.watch('secure')} onCheckedChange={(v) => form.setValue('secure', v)} />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="allowStarttls">Allow STARTTLS Upgrade</Label>
            <Switch id="allowStarttls" checked={form.watch('allowStarttls')} onCheckedChange={(v) => form.setValue('allowStarttls', v)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Authentication</CardTitle>
          <CardDescription>Choose password or OAuth2 authentication.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Authentication Type</Label>
            <CustomSelect
              id="imap-auth-type"
              value={authType}
              onValueChange={(v) => form.setValue('authType', v as 'password' | 'oauth2')}
              options={[
                { value: 'password', label: 'Password' },
                { value: 'oauth2', label: 'OAuth2 (XOAUTH2)' }
              ]}
            />
          </div>
          <div>
            <Label htmlFor="username">Username</Label>
            <Input id="username" {...form.register('username')} />
          </div>

          {authType === 'password' && (
            <div>
              <Label htmlFor="password">Password / App Password</Label>
              {isEditing && (
                <p className="text-xs text-muted-foreground mt-1">
                  Passwords are stored securely and will not be displayed. Leave blank to keep the existing password.
                </p>
              )}
              <div className="relative">
                <Input id="password" type={showPassword ? 'text' : 'password'} {...form.register('password')} />
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
                    <p className="font-medium">OAuth Status</p>
                    <p className="text-muted-foreground">{oauthConnected ? 'Connected' : 'Not connected'}</p>
                  </div>
                  <Button
                    id="imap-reconnect-oauth-btn"
                    type="button"
                    variant="outline"
                    onClick={handleOauthConnect}
                    disabled={oauthStatus === 'authorizing'}
                  >
                    {oauthStatus === 'authorizing' ? 'Authorizing...' : 'Reconnect OAuth'}
                  </Button>
                </div>
              )}
              <div>
                <Label htmlFor="oauthAuthorizeUrl">Authorize URL</Label>
                <Input id="oauthAuthorizeUrl" {...form.register('oauthAuthorizeUrl')} />
              </div>
              <div>
                <Label htmlFor="oauthTokenUrl">Token URL</Label>
                <Input id="oauthTokenUrl" {...form.register('oauthTokenUrl')} />
              </div>
              <div>
                <Label htmlFor="oauthClientId">OAuth Client ID</Label>
                <Input id="oauthClientId" {...form.register('oauthClientId')} />
              </div>
              <div>
                <Label htmlFor="oauthClientSecret">OAuth Client Secret</Label>
                <div className="relative">
                  <Input id="oauthClientSecret" type={showClientSecret ? 'text' : 'password'} {...form.register('oauthClientSecret')} />
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
                <Label htmlFor="oauthScopes">OAuth Scopes</Label>
                <Input id="oauthScopes" {...form.register('oauthScopes')} placeholder="space-delimited scopes" />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Processing Settings</CardTitle>
          <CardDescription>Choose folders and processing behavior.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="folderFilters">Folder Filters</Label>
            <Input id="folderFilters" {...form.register('folderFilters')} placeholder="Inbox, Support, Tickets" />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="isActive">Active</Label>
            <Switch id="isActive" checked={form.watch('isActive')} onCheckedChange={(v) => form.setValue('isActive', v)} />
          </div>
          <CustomSelect
            id="imap-defaults-select"
            label="Ticket Defaults"
            value={(form.getValues() as any).inboundTicketDefaultsId || ''}
            onValueChange={(v) => form.setValue('inboundTicketDefaultsId', v || undefined)}
            options={defaultsOptions}
            placeholder={defaultsOptions.length ? 'Select defaults...' : 'No defaults available'}
            allowClear
          />
        </CardContent>
      </Card>

      {hasAttemptedSubmit && Object.keys(form.formState.errors).length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>Please fix the highlighted fields and try again.</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end space-x-3">
        <Button id="imap-cancel-btn" type="button" variant="outline" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button id="imap-submit-btn" type="submit" disabled={loading}>
          {loading ? 'Saving...' : isEditing ? 'Update Provider' : 'Create Provider'}
        </Button>
      </div>
    </form>
  );
}
