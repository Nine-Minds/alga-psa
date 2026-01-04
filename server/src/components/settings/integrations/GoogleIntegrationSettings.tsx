/**
 * Google Integration Settings
 * Tenant-owned Google Cloud OAuth + Pub/Sub configuration
 */

'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/Card';
import { Alert, AlertDescription } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Label } from '../../ui/Label';
import { Switch } from '../../ui/Switch';
import { TextArea } from '../../ui/TextArea';
import { ExternalLink, RefreshCw } from 'lucide-react';
import {
  getGoogleIntegrationStatus,
  resetGoogleProvidersToDisconnected,
  saveGoogleIntegrationSettings
} from '@/lib/actions/integrations/googleActions';
import { useToast } from '@/hooks/use-toast';

export function GoogleIntegrationSettings() {
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
      setError(res.error || 'Failed to load Google settings');
    } else if (res.config) {
      setProjectId(res.config.projectId || '');
      setGmailClientId(res.config.gmailClientId || '');
      setUseSameForCalendar(res.config.usingSharedOAuthApp ?? true);
      setCalendarClientId(res.config.calendarClientId || '');
    }
    setLoading(false);
  }, []);

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
        setError(res.error || 'Failed to save Google settings');
        toast({ title: 'Unable to save Google settings', description: res.error || 'Unknown error', variant: 'destructive' });
        return;
      }
      toast({ title: 'Google settings saved', description: 'Tenant Google configuration updated successfully.' });
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
        setError(res.error || 'Failed to reset Google providers');
        toast({ title: 'Reset failed', description: res.error || 'Unknown error', variant: 'destructive' });
        return;
      }
      toast({ title: 'Google providers reset', description: 'All Google providers are now disconnected and require re-authorization.' });
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Google</CardTitle>
          <CardDescription>
            Configure tenant-owned Google Cloud credentials for Gmail inbound email and Google Calendar.
            <Button
              id="google-cloud-console-link"
              type="button"
              variant="link"
              className="ml-2 p-0 h-auto"
              onClick={() => window.open('https://console.cloud.google.com/apis/credentials', '_blank')}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              Google Cloud Console
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
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <>
              <div className="rounded-lg border bg-muted/20 p-4 space-y-2">
                <div className="text-sm font-medium">Redirect URIs (copy into Google OAuth client)</div>
                <div className="text-sm font-mono break-all">{status?.redirectUris?.gmail}</div>
                <div className="text-sm font-mono break-all">{status?.redirectUris?.calendar}</div>
                <div className="text-sm font-medium mt-2">Scopes</div>
                <div className="text-sm text-muted-foreground">
                  Gmail: {(status?.scopes?.gmail || []).join(', ')}
                </div>
                <div className="text-sm text-muted-foreground">
                  Calendar: {(status?.scopes?.calendar || []).join(', ')}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="google-project-id">Google Cloud project ID</Label>
                  <Input
                    id="google-project-id"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    placeholder="my-project-id"
                  />
                  <p className="text-xs text-muted-foreground">Used for Gmail Pub/Sub provisioning (tenant-owned service account).</p>
                </div>
              </div>

              <div className="rounded-lg border p-4 space-y-4">
                <div className="text-sm font-medium">OAuth app</div>

                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Use the same OAuth app for Gmail + Calendar</div>
                    <div className="text-xs text-muted-foreground">Recommended. You can still authorize separate Google accounts per integration.</div>
                  </div>
                  <Switch
                    id="google-same-app"
                    checked={useSameForCalendar}
                    onCheckedChange={(checked) => setUseSameForCalendar(Boolean(checked))}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="google-gmail-client-id">Gmail OAuth Client ID</Label>
                    <Input
                      id="google-gmail-client-id"
                      value={gmailClientId}
                      onChange={(e) => setGmailClientId(e.target.value)}
                      placeholder="xxxxxxxxx.apps.googleusercontent.com"
                    />
                    {status?.config?.gmailClientSecretMasked && (
                      <p className="text-xs text-muted-foreground">Stored secret: {status.config.gmailClientSecretMasked}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="google-gmail-client-secret">Gmail OAuth Client Secret</Label>
                    <Input
                      id="google-gmail-client-secret"
                      type="password"
                      value={gmailClientSecret}
                      onChange={(e) => setGmailClientSecret(e.target.value)}
                      placeholder="Enter client secret"
                    />
                  </div>

                  {!useSameForCalendar && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="google-calendar-client-id">Calendar OAuth Client ID</Label>
                        <Input
                          id="google-calendar-client-id"
                          value={calendarClientId}
                          onChange={(e) => setCalendarClientId(e.target.value)}
                          placeholder="xxxxxxxxx.apps.googleusercontent.com"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="google-calendar-client-secret">Calendar OAuth Client Secret</Label>
                        <Input
                          id="google-calendar-client-secret"
                          type="password"
                          value={calendarClientSecret}
                          onChange={(e) => setCalendarClientSecret(e.target.value)}
                          placeholder="Enter client secret"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-lg border p-4 space-y-2">
                <div className="text-sm font-medium">Pub/Sub service account (required for Gmail)</div>
                <p className="text-xs text-muted-foreground">
                  Paste the service account key JSON for the tenant-owned service account used to provision Pub/Sub.
                </p>
                {status?.config?.hasServiceAccountKey && (
                  <p className="text-xs text-muted-foreground">A service account key is already stored (not shown).</p>
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
                  Refresh
                </Button>
                <div className="flex items-center gap-2">
                  <Button id="google-settings-reset-providers" type="button" variant="destructive" onClick={handleResetProviders} disabled={resetting}>
                    {resetting ? 'Resetting…' : 'Reset Google Providers'}
                  </Button>
                  <Button id="google-settings-save" type="button" onClick={handleSave} disabled={!canSave || saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>

              <Alert variant="info">
                <AlertDescription>
                  After saving, go to <strong>Inbound Email</strong> and <strong>Calendar</strong> integrations and re-authorize providers.
                  Existing Google providers are not migrated.
                </AlertDescription>
              </Alert>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
