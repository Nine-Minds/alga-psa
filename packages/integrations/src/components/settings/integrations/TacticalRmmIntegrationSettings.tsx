'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Eye, EyeOff, RefreshCw, Save, Unlink } from 'lucide-react';
import { useToast } from '@alga-psa/ui/hooks/use-toast';
import {
  disconnectTacticalRmmIntegration,
  getTacticalRmmSettings,
  saveTacticalRmmConfiguration,
  testTacticalRmmConnection,
  type TacticalRmmAuthMode,
} from '@alga-psa/integrations/actions';

export function TacticalRmmIntegrationSettings() {
  const { toast } = useToast();

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState(false);
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

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await getTacticalRmmSettings();
      if (!res.success) {
        setError(res.error || 'Failed to load Tactical RMM settings');
        return;
      }

      setInstanceUrl(res.config?.instanceUrl || '');
      setAuthMode(res.config?.authMode || 'api_key');
      setCredentialsStatus(res.credentials || null);

      if (res.credentials?.username) setUsername(res.credentials.username);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

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
