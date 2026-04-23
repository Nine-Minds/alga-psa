/**
 * Google Integration Settings
 * Tenant-owned Google Cloud OAuth + Pub/Sub configuration
 */

'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { ExternalLink, RefreshCw } from 'lucide-react';
import {
  getGoogleIntegrationStatus,
  resetGoogleProvidersToDisconnected,
  saveGoogleIntegrationSettings
} from '@alga-psa/integrations/actions';
import { useToast } from '@alga-psa/ui/hooks/use-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export function GoogleIntegrationSettings() {
  const { t } = useTranslation('msp/integrations');
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<Awaited<ReturnType<typeof getGoogleIntegrationStatus>> | null>(null);

  const [projectId, setProjectId] = React.useState('');
  const [gmailClientId, setGmailClientId] = React.useState('');
  const [gmailClientSecret, setGmailClientSecret] = React.useState('');
  const [serviceAccountKeyJson, setServiceAccountKeyJson] = React.useState('');
  const [useSameForCalendar, setUseSameForCalendar] = React.useState(true);
  const [calendarClientId, setCalendarClientId] = React.useState('');
  const [calendarClientSecret, setCalendarClientSecret] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getGoogleIntegrationStatus();
    setStatus(res);
    if (!res.success) {
      setError(t('integrations.google.settings.errors.loadFailed', { defaultValue: 'Failed to load Google settings' }));
    } else if (res.config) {
      setProjectId(res.config.projectId || '');
      setGmailClientId(res.config.gmailClientId || '');
      setUseSameForCalendar(res.config.usingSharedOAuthApp !== false);
      setCalendarClientId(res.config.calendarClientId || '');
    }
    setLoading(false);
  }, [t]);

  React.useEffect(() => {
    load();
  }, [load]);

  const canSave = projectId.trim() && gmailClientId.trim() && gmailClientSecret.trim() && serviceAccountKeyJson.trim()
    && (useSameForCalendar || (calendarClientId.trim() && calendarClientSecret.trim()));

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      const res = await saveGoogleIntegrationSettings({
        projectId,
        gmailClientId,
        gmailClientSecret,
        serviceAccountKeyJson,
        useSameOAuthAppForCalendar: useSameForCalendar,
        calendarClientId: useSameForCalendar ? undefined : calendarClientId,
        calendarClientSecret: useSameForCalendar ? undefined : calendarClientSecret
      });
      if (!res.success) {
        setError(t('integrations.google.settings.errors.saveFailed', { defaultValue: 'Failed to save Google settings' }));
        toast({ title: t('integrations.google.settings.toasts.saveFailedTitle', { defaultValue: 'Unable to save Google settings' }), description: t('integrations.google.settings.toasts.unknownError', { defaultValue: 'Unknown error' }), variant: 'destructive' });
        return;
      }
      toast({ title: t('integrations.google.settings.toasts.savedTitle', { defaultValue: 'Google settings saved' }), description: t('integrations.google.settings.toasts.savedDescription', { defaultValue: 'Tenant Google configuration updated successfully.' }) });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleResetProviders = async () => {
    try {
      setResetting(true);
      setError(null);
      const res = await resetGoogleProvidersToDisconnected();
      if (!res.success) {
        setError(t('integrations.google.settings.errors.resetFailed', { defaultValue: 'Failed to reset Google providers' }));
        toast({ title: t('integrations.google.settings.toasts.resetFailedTitle', { defaultValue: 'Reset failed' }), description: t('integrations.google.settings.toasts.unknownError', { defaultValue: 'Unknown error' }), variant: 'destructive' });
        return;
      }
      toast({ title: t('integrations.google.settings.toasts.resetTitle', { defaultValue: 'Google providers reset' }), description: t('integrations.google.settings.toasts.resetDescription', { defaultValue: 'All Google providers are now disconnected and require re-authorization.' }) });
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('integrations.google.settings.title', { defaultValue: 'Google' })}</CardTitle>
          <CardDescription>
            {t('integrations.google.settings.description', { defaultValue: 'Configure tenant-owned Google Cloud credentials for Gmail inbound email and Google Calendar.' })}
            <Button
              id="google-cloud-console-link"
              type="button"
              variant="link"
              className="ml-2 p-0 h-auto"
              onClick={() => window.open('https://console.cloud.google.com/apis/credentials', '_blank')}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              {t('integrations.google.settings.consoleLink', { defaultValue: 'Google Cloud Console' })}
            </Button>
            <Button
              id="google-cloud-docs-link"
              type="button"
              variant="link"
              className="ml-3 p-0 h-auto"
              onClick={() => window.open('https://nineminds.com/documentation?doc=1014-google-cloud-connector-settings', '_blank')}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              {t('integrations.google.settings.setupGuide', { defaultValue: 'Setup guide' })}
            </Button>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {loading ? (
            <div className="text-sm text-muted-foreground">{t('integrations.google.settings.loading', { defaultValue: 'Loading…' })}</div>
          ) : (
            <>
              <div className="rounded-lg border bg-muted/20 p-4 space-y-2">
                <div className="text-sm font-medium">{t('integrations.google.settings.redirectUrisLabel', { defaultValue: 'Redirect URIs (copy into Google OAuth client)' })}</div>
                <div className="text-sm font-mono break-all">{status?.redirectUris?.gmail}</div>
                <div className="text-sm font-mono break-all">{status?.redirectUris?.calendar}</div>
                <div className="text-sm font-medium mt-2">{t('integrations.google.settings.scopes', { defaultValue: 'Scopes' })}</div>
                <div className="text-sm text-muted-foreground">
                  {t('integrations.google.settings.scopesGmail', { defaultValue: 'Gmail: {{scopes}}', scopes: (status?.scopes?.gmail || []).join(', ') })}
                </div>
                <div className="text-sm text-muted-foreground">
                  {t('integrations.google.settings.scopesCalendar', { defaultValue: 'Calendar: {{scopes}}', scopes: (status?.scopes?.calendar || []).join(', ') })}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="google-project-id">{t('integrations.google.settings.fields.projectIdLabel', { defaultValue: 'Google Cloud project ID' })}</Label>
                  <Input
                    id="google-project-id"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    placeholder={t('integrations.google.settings.fields.projectIdPlaceholder', { defaultValue: 'my-project-id' })}
                  />
                  <p className="text-xs text-muted-foreground">{t('integrations.google.settings.fields.projectIdHelp', { defaultValue: 'Used for Gmail Pub/Sub provisioning (tenant-owned service account).' })}</p>
                </div>
              </div>

              <div className="rounded-lg border p-4 space-y-4">
                <div className="text-sm font-medium">{t('integrations.google.settings.oauth.sectionTitle', { defaultValue: 'OAuth app' })}</div>

                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">{t('integrations.google.settings.oauth.shareApp', { defaultValue: 'Use the same OAuth app for Gmail + Calendar' })}</div>
                    <div className="text-xs text-muted-foreground">{t('integrations.google.settings.oauth.shareAppHelp', { defaultValue: 'Recommended. You can still authorize separate Google accounts per integration.' })}</div>
                  </div>
                  <Switch
                    id="google-same-app"
                    checked={useSameForCalendar}
                    onCheckedChange={(checked) => setUseSameForCalendar(Boolean(checked))}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="google-gmail-client-id">{t('integrations.google.settings.oauth.gmailClientId', { defaultValue: 'Gmail OAuth Client ID' })}</Label>
                    <Input
                      id="google-gmail-client-id"
                      value={gmailClientId}
                      onChange={(e) => setGmailClientId(e.target.value)}
                      placeholder="xxxxxxxxx.apps.googleusercontent.com"
                    />
                    {status?.config?.gmailClientSecretMasked && (
                      <p className="text-xs text-muted-foreground">{t('integrations.google.settings.oauth.storedSecret', { defaultValue: 'Stored secret: {{secret}}', secret: status.config.gmailClientSecretMasked })}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="google-gmail-client-secret">{t('integrations.google.settings.oauth.gmailClientSecret', { defaultValue: 'Gmail OAuth Client Secret' })}</Label>
                    <Input
                      id="google-gmail-client-secret"
                      type="password"
                      value={gmailClientSecret}
                      onChange={(e) => setGmailClientSecret(e.target.value)}
                      placeholder={t('integrations.google.settings.oauth.enterSecret', { defaultValue: 'Enter client secret' })}
                    />
                  </div>

                  {!useSameForCalendar && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="google-calendar-client-id">{t('integrations.google.settings.oauth.calendarClientId', { defaultValue: 'Calendar OAuth Client ID' })}</Label>
                        <Input
                          id="google-calendar-client-id"
                          value={calendarClientId}
                          onChange={(e) => setCalendarClientId(e.target.value)}
                          placeholder="xxxxxxxxx.apps.googleusercontent.com"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="google-calendar-client-secret">{t('integrations.google.settings.oauth.calendarClientSecret', { defaultValue: 'Calendar OAuth Client Secret' })}</Label>
                        <Input
                          id="google-calendar-client-secret"
                          type="password"
                          value={calendarClientSecret}
                          onChange={(e) => setCalendarClientSecret(e.target.value)}
                          placeholder={t('integrations.google.settings.oauth.enterSecret', { defaultValue: 'Enter client secret' })}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-lg border p-4 space-y-2">
                <div className="text-sm font-medium">{t('integrations.google.settings.serviceAccount.title', { defaultValue: 'Pub/Sub service account (required for Gmail)' })}</div>
                <p className="text-xs text-muted-foreground">
                  {t('integrations.google.settings.serviceAccount.description', { defaultValue: 'Paste the service account key JSON for the tenant-owned service account used to provision Pub/Sub.' })}
                </p>
                {status?.config?.hasServiceAccountKey && (
                  <p className="text-xs text-muted-foreground">{t('integrations.google.settings.serviceAccount.alreadyStored', { defaultValue: 'A service account key is already stored (not shown).' })}</p>
                )}
                <TextArea
                  id="google-service-account-json"
                  value={serviceAccountKeyJson}
                  onChange={(e) => setServiceAccountKeyJson(e.target.value)}
                  placeholder='{"type":"service_account","project_id":"...","private_key_id":"...","private_key":"...","client_email":"..."}'
                  rows={8}
                />
              </div>

              <div className="flex items-center justify-between">
                <Button id="google-settings-refresh" type="button" variant="outline" onClick={load} disabled={loading}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {t('integrations.google.settings.actions.refresh', { defaultValue: 'Refresh' })}
                </Button>
                <div className="flex items-center gap-2">
                  <Button id="google-settings-reset-providers" type="button" variant="destructive" onClick={handleResetProviders} disabled={resetting}>
                    {resetting
                      ? t('integrations.google.settings.actions.resetting', { defaultValue: 'Resetting…' })
                      : t('integrations.google.settings.actions.resetProviders', { defaultValue: 'Reset Google Providers' })}
                  </Button>
                  <Button id="google-settings-save" type="button" onClick={handleSave} disabled={!canSave || saving}>
                    {saving
                      ? t('integrations.google.settings.actions.saving', { defaultValue: 'Saving…' })
                      : t('integrations.google.settings.actions.save', { defaultValue: 'Save' })}
                  </Button>
                </div>
              </div>

              <Alert variant="info">
                <AlertDescription>
                  {t('integrations.google.settings.afterSaveNotice', { defaultValue: 'After saving, go to Inbound Email and Calendar integrations and re-authorize providers. Existing Google providers are not migrated.' })}
                </AlertDescription>
              </Alert>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
