'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Eye, EyeOff, RefreshCw, Save, Unlink } from 'lucide-react';
import { useToast } from '@alga-psa/ui/hooks/use-toast';
import {
  disconnectTacticalRmmIntegration,
  getTacticalRmmConnectionSummary,
  getTacticalRmmSettings,
  listTacticalRmmOrganizationMappings,
  saveTacticalRmmConfiguration,
  syncTacticalRmmOrganizations,
  syncTacticalRmmDevices,
  testTacticalRmmConnection,
  updateTacticalRmmOrganizationMapping,
  type TacticalRmmAuthMode,
} from '@alga-psa/integrations/actions';
import { getAllClientsForAssets } from '@alga-psa/assets/actions/clientLookupActions';
import type { IClient } from '@alga-psa/types';

export function TacticalRmmIntegrationSettings() {
  const { toast } = useToast();

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState(false);
  const [syncingOrgs, setSyncingOrgs] = React.useState(false);
  const [syncingDevices, setSyncingDevices] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const [instanceUrl, setInstanceUrl] = React.useState('');
  const [authMode, setAuthMode] = React.useState<TacticalRmmAuthMode>('api_key');

  const [apiKey, setApiKey] = React.useState('');
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [totpCode, setTotpCode] = React.useState('');

  const [showApiKey, setShowApiKey] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);

  const [credentialsStatus, setCredentialsStatus] = React.useState<{
    hasApiKey: boolean;
    apiKeyMasked?: string;
    hasKnoxCredentials: boolean;
    username?: string;
    hasKnoxToken: boolean;
    knoxTokenMasked?: string;
  } | null>(null);

  const [totpRequired, setTotpRequired] = React.useState(false);

  const [connectionSummary, setConnectionSummary] = React.useState<Awaited<ReturnType<typeof getTacticalRmmConnectionSummary>>['summary'] | null>(null);
  const [orgMappings, setOrgMappings] = React.useState<NonNullable<Awaited<ReturnType<typeof listTacticalRmmOrganizationMappings>>['mappings']>>([]);
  const [clients, setClients] = React.useState<IClient[]>([]);
  const [clientsLoading, setClientsLoading] = React.useState(false);
  const [clientFilterState, setClientFilterState] = React.useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = React.useState<'all' | 'company' | 'individual'>('all');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const [res, summaryRes] = await Promise.all([
        getTacticalRmmSettings(),
        getTacticalRmmConnectionSummary(),
      ]);
      if (!res.success) {
        setError(res.error || 'Failed to load Tactical RMM settings');
        return;
      }

      setInstanceUrl(res.config?.instanceUrl || '');
      setAuthMode(res.config?.authMode || 'api_key');
      setCredentialsStatus(res.credentials || null);
      setConnectionSummary(summaryRes.success ? (summaryRes.summary || null) : null);

      if (res.credentials?.username) setUsername(res.credentials.username);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOrgMappings = React.useCallback(async () => {
    const res = await listTacticalRmmOrganizationMappings();
    if (!res.success) {
      setError(res.error || 'Failed to load organization mappings');
      return;
    }
    setOrgMappings(res.mappings || []);
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    void loadOrgMappings();
  }, [loadOrgMappings]);

  React.useEffect(() => {
    const run = async () => {
      setClientsLoading(true);
      try {
        const data = await getAllClientsForAssets(true);
        setClients(data as any);
      } catch (e) {
        setClients([]);
      } finally {
        setClientsLoading(false);
      }
    };
    void run();
  }, []);

  const canSave = instanceUrl.trim() && (
    authMode === 'api_key'
      ? apiKey.trim().length > 0
      : username.trim().length > 0 && password.trim().length > 0
  );

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    setTotpRequired(false);
    try {
      const res = await saveTacticalRmmConfiguration({
        instanceUrl,
        authMode,
        apiKey: authMode === 'api_key' ? apiKey : undefined,
        username: authMode === 'knox' ? username : undefined,
        password: authMode === 'knox' ? password : undefined,
      });
      if (!res.success) {
        setError(res.error || 'Failed to save Tactical RMM configuration');
        toast({ title: 'Save failed', description: res.error || 'Unknown error', variant: 'destructive' });
        return;
      }

      setSuccess('Tactical RMM configuration saved.');
      toast({ title: 'Saved', description: 'Tactical RMM configuration updated.' });

      // Clear sensitive fields after save; status will reflect what is stored.
      setApiKey('');
      setPassword('');
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await testTacticalRmmConnection(totpRequired ? { totpCode } : undefined);
      if (!res.success) {
        if (res.totpRequired) {
          setTotpRequired(true);
          setError('TOTP is required. Enter your current code and test again.');
          return;
        }
        setError(res.error || 'Connection test failed');
        toast({ title: 'Connection failed', description: res.error || 'Unknown error', variant: 'destructive' });
        return;
      }

      setTotpRequired(false);
      setTotpCode('');
      setSuccess('Connection successful.');
      toast({ title: 'Connected', description: 'Tactical RMM connection verified.' });
      await load();
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError(null);
    setSuccess(null);
    setTotpRequired(false);
    try {
      const res = await disconnectTacticalRmmIntegration();
      if (!res.success) {
        setError(res.error || 'Disconnect failed');
        toast({ title: 'Disconnect failed', description: res.error || 'Unknown error', variant: 'destructive' });
        return;
      }
      setSuccess('Disconnected.');
      toast({ title: 'Disconnected', description: 'Tactical RMM credentials cleared.' });
      setApiKey('');
      setPassword('');
      setTotpCode('');
      await load();
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSyncOrganizations = async () => {
    setSyncingOrgs(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await syncTacticalRmmOrganizations();
      if (!res.success) {
        setError(res.error || 'Organization sync failed');
        toast({ title: 'Sync failed', description: res.error || 'Unknown error', variant: 'destructive' });
        return;
      }
      setSuccess(
        `Organization sync completed. Processed: ${res.items_processed}, Created: ${res.items_created}, Updated: ${res.items_updated}, Failed: ${res.items_failed}`
      );
      if (res.errors?.length) {
        setError(`Some organizations failed to sync: ${res.errors.slice(0, 3).join('; ')}`);
      }
      toast({ title: 'Organizations synced', description: 'Tactical clients have been synced into org mappings.' });
      await load();
    } finally {
      setSyncingOrgs(false);
    }
  };

  const handleSyncDevices = async () => {
    setSyncingDevices(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await syncTacticalRmmDevices();
      if (!res.success) {
        setError(res.error || 'Device sync failed');
        toast({ title: 'Sync failed', description: res.error || 'Unknown error', variant: 'destructive' });
        return;
      }
      setSuccess(
        `Device sync completed. Processed: ${res.items_processed}, Created: ${res.items_created}, Updated: ${res.items_updated}, Deleted: ${res.items_deleted}, Failed: ${res.items_failed}`
      );
      if (res.errors?.length) {
        setError(`Some devices failed to sync: ${res.errors.slice(0, 3).join('; ')}`);
      }
      toast({ title: 'Devices synced', description: 'Tactical agents have been synced into assets.' });
      await load();
    } finally {
      setSyncingDevices(false);
    }
  };

  const handleUpdateMapping = async (mappingId: string, patch: { clientId?: string | null; autoSyncAssets?: boolean }) => {
    setError(null);
    const res = await updateTacticalRmmOrganizationMapping({
      mappingId,
      clientId: patch.clientId,
      autoSyncAssets: patch.autoSyncAssets,
    });
    if (!res.success) {
      setError(res.error || 'Failed to update mapping');
      toast({ title: 'Update failed', description: res.error || 'Unknown error', variant: 'destructive' });
      return;
    }
    await loadOrgMappings();
  };

  return (
    <Card id="tacticalrmm-integration-settings-card">
      <CardHeader>
        <CardTitle>Tactical RMM</CardTitle>
        <CardDescription>
          Connect Tactical RMM to sync assets and ingest alerts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {success && (
          <Alert className="mb-4">
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-6">
          <div className="rounded-md border bg-muted/30 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">
                  {connectionSummary?.isActive ? 'Connected' : 'Disconnected'}
                </div>
                <div className="text-xs text-muted-foreground">
                  {connectionSummary?.instanceUrl ? connectionSummary.instanceUrl : 'Instance URL not set'}
                  {connectionSummary?.authMode ? ` • Auth: ${connectionSummary.authMode === 'api_key' ? 'API key' : 'Knox'}` : null}
                </div>
              </div>
              <Button
                id="tacticalrmm-refresh-status"
                type="button"
                variant="outline"
                size="sm"
                onClick={load}
                disabled={loading || saving || testing || disconnecting}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>

            {connectionSummary && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                <div className="rounded border bg-background p-2">
                  <div className="text-muted-foreground">Mapped Orgs</div>
                  <div className="text-sm font-semibold">{connectionSummary.counts.mappedOrganizations}</div>
                </div>
                <div className="rounded border bg-background p-2">
                  <div className="text-muted-foreground">Synced Devices</div>
                  <div className="text-sm font-semibold">{connectionSummary.counts.syncedDevices}</div>
                </div>
                <div className="rounded border bg-background p-2">
                  <div className="text-muted-foreground">Active Alerts</div>
                  <div className="text-sm font-semibold">{connectionSummary.counts.activeAlerts}</div>
                </div>
                <div className="rounded border bg-background p-2">
                  <div className="text-muted-foreground">Last Sync</div>
                  <div className="text-sm font-semibold">
                    {connectionSummary.lastSyncAt ? new Date(connectionSummary.lastSyncAt).toLocaleString() : 'Never'}
                  </div>
                </div>
              </div>
            )}

            {connectionSummary?.syncError && (
              <div className="mt-3 text-xs text-destructive">
                Last error: {connectionSummary.syncError}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="tacticalrmm-instance-url">Instance URL</Label>
            <Input
              id="tacticalrmm-instance-url"
              placeholder="https://rmm.example.com"
              value={instanceUrl}
              onChange={(e) => setInstanceUrl(e.target.value)}
              disabled={loading || saving || disconnecting}
            />
            <div className="text-xs text-muted-foreground">
              Use your Tactical base URL (no trailing <code>/api</code>).
            </div>
          </div>

          <div className="rounded-md border bg-background p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">Organizations</div>
                <div className="text-xs text-muted-foreground">
                  Sync Tactical Clients into Alga org mappings, then map them to Alga Clients.
                </div>
              </div>
              <Button
                id="tacticalrmm-sync-organizations"
                type="button"
                onClick={handleSyncOrganizations}
                disabled={syncingOrgs || loading || saving || testing || disconnecting}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${syncingOrgs ? 'animate-spin' : ''}`} />
                {syncingOrgs ? 'Syncing...' : 'Sync Clients'}
              </Button>
            </div>
          </div>

          <div className="rounded-md border bg-background p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">Organization Mapping</div>
                <div className="text-xs text-muted-foreground">
                  Assign each Tactical Client to an Alga Client and control auto-sync per org.
                </div>
              </div>
              <Button
                id="tacticalrmm-refresh-mappings"
                type="button"
                variant="outline"
                size="sm"
                onClick={loadOrgMappings}
                disabled={loading || syncingOrgs || syncingDevices || saving || testing || disconnecting}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>

            {orgMappings.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No organizations found. Run "Sync Clients" first.
              </div>
            ) : (
              <div className="space-y-2">
                {orgMappings.map((m) => (
                  <div key={m.mapping_id} className="flex flex-col lg:flex-row lg:items-center gap-3 rounded border p-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {m.external_organization_name || m.external_organization_id}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        Tactical ID: {m.external_organization_id}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <ClientPicker
                        id={`tacticalrmm-org-client-picker-${m.mapping_id}`}
                        clients={clients}
                        selectedClientId={m.client_id || null}
                        onSelect={(clientId) => handleUpdateMapping(m.mapping_id, { clientId })}
                        filterState={clientFilterState}
                        onFilterStateChange={setClientFilterState}
                        clientTypeFilter={clientTypeFilter}
                        onClientTypeFilterChange={setClientTypeFilter}
                        placeholder={clientsLoading ? 'Loading clients…' : 'Select client'}
                        fitContent
                        triggerVariant="outline"
                        triggerSize="sm"
                        className="min-w-[220px]"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <Switch
                        id={`tacticalrmm-org-autosync-${m.mapping_id}`}
                        checked={Boolean(m.auto_sync_assets)}
                        onCheckedChange={(checked) => handleUpdateMapping(m.mapping_id, { autoSyncAssets: checked })}
                      />
                      <span className="text-sm">Auto-sync</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-md border bg-background p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">Devices</div>
                <div className="text-xs text-muted-foreground">
                  Sync Tactical Agents into Alga Assets for mapped organizations.
                </div>
              </div>
              <Button
                id="tacticalrmm-sync-devices"
                type="button"
                onClick={handleSyncDevices}
                disabled={syncingDevices || loading || saving || testing || disconnecting}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${syncingDevices ? 'animate-spin' : ''}`} />
                {syncingDevices ? 'Syncing...' : 'Sync Devices'}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tacticalrmm-auth-mode">Authentication</Label>
            <CustomSelect
              id="tacticalrmm-auth-mode"
              value={authMode}
              onValueChange={(v) => {
                setAuthMode(v as TacticalRmmAuthMode);
                setTotpRequired(false);
                setTotpCode('');
                setError(null);
                setSuccess(null);
              }}
              options={[
                { value: 'api_key', label: 'API key' },
                { value: 'knox', label: 'Username/password (Knox token)' },
              ]}
            />
          </div>

          {authMode === 'api_key' ? (
            <div className="space-y-2">
              <Label htmlFor="tacticalrmm-api-key">API key</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="tacticalrmm-api-key"
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={credentialsStatus?.apiKeyMasked ? credentialsStatus.apiKeyMasked : 'Enter API key'}
                  disabled={loading || saving || disconnecting}
                />
                <Button
                  id="tacticalrmm-toggle-api-key-visibility"
                  type="button"
                  variant="outline"
                  onClick={() => setShowApiKey((s) => !s)}
                  disabled={loading || saving || disconnecting}
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {credentialsStatus?.hasApiKey && (
                <div className="text-xs text-muted-foreground">
                  Saved: {credentialsStatus.apiKeyMasked}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="tacticalrmm-username">Username</Label>
                <Input
                  id="tacticalrmm-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  disabled={loading || saving || disconnecting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tacticalrmm-password">Password</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="tacticalrmm-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={credentialsStatus?.hasKnoxCredentials ? 'Saved (enter to update)' : 'Enter password'}
                    disabled={loading || saving || disconnecting}
                  />
                  <Button
                    id="tacticalrmm-toggle-password-visibility"
                    type="button"
                    variant="outline"
                    onClick={() => setShowPassword((s) => !s)}
                    disabled={loading || saving || disconnecting}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              {totpRequired && (
                <div className="space-y-2">
                  <Label htmlFor="tacticalrmm-totp">TOTP code</Label>
                  <Input
                    id="tacticalrmm-totp"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder="123456"
                    disabled={testing || disconnecting}
                  />
                </div>
              )}

              {credentialsStatus?.hasKnoxToken && (
                <div className="text-xs text-muted-foreground">
                  Knox token saved: {credentialsStatus.knoxTokenMasked}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              id="tacticalrmm-save-config"
              type="button"
              onClick={handleSave}
              disabled={!canSave || saving || loading || disconnecting}
            >
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Saving...' : 'Save'}
            </Button>

            <Button
              id="tacticalrmm-test-connection"
              type="button"
              variant="secondary"
              onClick={handleTestConnection}
              disabled={testing || loading || disconnecting || (totpRequired && !totpCode.trim())}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${testing ? 'animate-spin' : ''}`} />
              {testing ? 'Testing...' : 'Test Connection'}
            </Button>

            <Button
              id="tacticalrmm-disconnect"
              type="button"
              variant="destructive"
              onClick={handleDisconnect}
              disabled={disconnecting || loading}
            >
              <Unlink className="h-4 w-4 mr-2" />
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          </div>

          {!loading && credentialsStatus && (
            <div className="text-xs text-muted-foreground">
              Status: {credentialsStatus.hasApiKey || credentialsStatus.hasKnoxCredentials ? 'Configured' : 'Not configured'}
            </div>
          )}

          {loading && (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Loading Tactical RMM settings...
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default TacticalRmmIntegrationSettings;
