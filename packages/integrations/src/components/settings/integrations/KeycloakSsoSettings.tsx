'use client';

import React from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { useToast } from '@alga-psa/ui/hooks/use-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { KeyRound, RefreshCw } from 'lucide-react';
import {
  clearKeycloakSsoSettings,
  getKeycloakSsoStatus,
  saveKeycloakSsoSettings,
  type KeycloakSsoStatus,
} from '../../../actions/integrations/keycloakSsoActions';

const isEnterprise = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

interface KeycloakSsoSettingsProps {
  onStatusChange?: (status: KeycloakSsoStatus) => void;
}

export function KeycloakSsoSettings({ onStatusChange }: KeycloakSsoSettingsProps) {
  const { t } = useTranslation('msp/integrations');
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<KeycloakSsoStatus | null>(null);

  const [url, setUrl] = React.useState('');
  const [realm, setRealm] = React.useState('');
  const [clientId, setClientId] = React.useState('');
  const [clientSecret, setClientSecret] = React.useState('');

  const configured = Boolean(status?.config?.configured);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getKeycloakSsoStatus();
    setStatus(result);
    onStatusChange?.(result);
    if (!result.success) {
      setError(result.error || t('integrations.sso.keycloak.errors.loadFailed', { defaultValue: 'Failed to load Keycloak settings' }));
    } else if (result.config) {
      setUrl(result.config.url || '');
      setRealm(result.config.realm || '');
      setClientId(result.config.clientId || '');
      setClientSecret('');
    }
    setLoading(false);
  }, [onStatusChange, t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const canSave = Boolean(url.trim() && realm.trim() && clientId.trim() && (clientSecret.trim() || configured));

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      const result = await saveKeycloakSsoSettings({ url, realm, clientId, clientSecret });
      if (!result.success) {
        const message = result.error || t('integrations.sso.keycloak.errors.saveFailed', { defaultValue: 'Failed to save Keycloak settings' });
        setError(message);
        toast({
          title: t('integrations.sso.keycloak.toasts.saveFailedTitle', { defaultValue: 'Unable to save Keycloak settings' }),
          description: message,
          variant: 'destructive',
        });
        return;
      }
      toast({
        title: t('integrations.sso.keycloak.toasts.savedTitle', { defaultValue: 'Keycloak settings saved' }),
        description: t('integrations.sso.keycloak.toasts.savedDescription', { defaultValue: 'The realm answered OpenID discovery and staff can now sign in with Keycloak.' }),
      });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    try {
      setRemoving(true);
      setError(null);
      const result = await clearKeycloakSsoSettings();
      if (!result.success) {
        const message = result.error || t('integrations.sso.keycloak.errors.removeFailed', { defaultValue: 'Failed to remove Keycloak settings' });
        setError(message);
        toast({
          title: t('integrations.sso.keycloak.toasts.removeFailedTitle', { defaultValue: 'Unable to remove Keycloak settings' }),
          description: message,
          variant: 'destructive',
        });
        return;
      }
      toast({
        title: t('integrations.sso.keycloak.toasts.removedTitle', { defaultValue: 'Keycloak settings removed' }),
        description: t('integrations.sso.keycloak.toasts.removedDescription', { defaultValue: 'Keycloak sign-in is no longer offered for this tenant.' }),
      });
      setRemoveDialogOpen(false);
      setClientSecret('');
      await load();
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-primary" />
                {t('integrations.sso.keycloak.title', { defaultValue: 'Keycloak / OpenID Connect' })}
                <Badge variant={configured ? 'success' : 'secondary'} size="sm">
                  {configured
                    ? t('integrations.sso.keycloak.status.configured', { defaultValue: 'Configured' })
                    : t('integrations.sso.keycloak.status.notConfigured', { defaultValue: 'Not configured' })}
                </Badge>
              </CardTitle>
              <CardDescription>
                {t('integrations.sso.keycloak.description', { defaultValue: 'Let staff sign in through your own Keycloak realm. Users are matched by email to existing AlgaPSA accounts; Keycloak never creates users here.' })}
              </CardDescription>
            </div>
            <Button id="keycloak-sso-refresh" type="button" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('integrations.sso.keycloak.actions.refresh', { defaultValue: 'Refresh' })}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Alert variant="info">
            <AlertDescription className="space-y-1">
              <p>
                {t('integrations.sso.keycloak.setup.redirectUri', { defaultValue: 'Create a confidential OpenID Connect client in your realm and allow this redirect URI:' })}
              </p>
              <code id="keycloak-sso-redirect-uri" className="block break-all rounded bg-muted px-2 py-1 text-xs">
                {status?.redirectUri || '…'}
              </code>
              <p>
                {isEnterprise
                  ? t('integrations.sso.keycloak.setup.domainsEe', { defaultValue: 'Then claim and verify your staff login domain under Advanced below so sign-in routes emails from that domain to this realm.' })
                  : t('integrations.sso.keycloak.setup.domainsCe', { defaultValue: 'Then add your staff login domain under Advanced below so sign-in routes emails from that domain to this realm.' })}
              </p>
            </AlertDescription>
          </Alert>

          {/* Password managers read "text field then password field" as a login form and
              autofill the admin's own credentials into it; the names and hints below opt out. */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="keycloak-sso-url">{t('integrations.sso.keycloak.fields.url', { defaultValue: 'Keycloak server URL' })}</Label>
              <Input
                id="keycloak-sso-url"
                name="keycloak-server-url"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://keycloak.example.com"
                disabled={loading || saving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="keycloak-sso-realm">{t('integrations.sso.keycloak.fields.realm', { defaultValue: 'Realm' })}</Label>
              <Input
                id="keycloak-sso-realm"
                name="keycloak-realm"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                value={realm}
                onChange={(event) => setRealm(event.target.value)}
                placeholder="my-company"
                disabled={loading || saving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="keycloak-sso-client-id">{t('integrations.sso.keycloak.fields.clientId', { defaultValue: 'Client ID' })}</Label>
              <Input
                id="keycloak-sso-client-id"
                name="keycloak-oidc-client-id"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                placeholder="algapsa"
                disabled={loading || saving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="keycloak-sso-client-secret">{t('integrations.sso.keycloak.fields.clientSecret', { defaultValue: 'Client secret' })}</Label>
              <Input
                id="keycloak-sso-client-secret"
                name="keycloak-oidc-client-secret"
                type="password"
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
                placeholder={status?.config?.clientSecretMasked
                  ? t('integrations.sso.keycloak.fields.clientSecretKeep', { defaultValue: 'Leave blank to keep {{masked}}', masked: status.config.clientSecretMasked })
                  : ''}
                disabled={loading || saving}
              />
            </div>
          </div>

          {status?.config?.issuer && (
            <p className="text-xs text-muted-foreground">
              {t('integrations.sso.keycloak.setup.issuer', { defaultValue: 'Issuer: {{issuer}}', issuer: status.config.issuer })}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {configured && (
              <Button id="keycloak-sso-remove" type="button" variant="destructive" onClick={() => setRemoveDialogOpen(true)} disabled={removing || saving}>
                {t('integrations.sso.keycloak.actions.remove', { defaultValue: 'Remove' })}
              </Button>
            )}
            <Button id="keycloak-sso-save" type="button" onClick={() => void handleSave()} disabled={!canSave || saving || loading}>
              {saving
                ? t('integrations.sso.keycloak.actions.saving', { defaultValue: 'Verifying and saving…' })
                : t('integrations.sso.keycloak.actions.save', { defaultValue: 'Verify and save' })}
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmationDialog
        id="keycloak-sso-remove-dialog"
        isOpen={removeDialogOpen}
        onClose={() => setRemoveDialogOpen(false)}
        onConfirm={handleRemove}
        title={t('integrations.sso.keycloak.removeDialog.title', { defaultValue: 'Remove Keycloak sign-in?' })}
        message={t('integrations.sso.keycloak.removeDialog.message', { defaultValue: 'Staff will no longer see the Keycloak button. Existing password sign-in is unaffected.' })}
        confirmLabel={t('integrations.sso.keycloak.removeDialog.confirm', { defaultValue: 'Remove' })}
        cancelLabel={t('integrations.sso.keycloak.removeDialog.cancel', { defaultValue: 'Cancel' })}
        isConfirming={removing}
      />
    </>
  );
}

export default KeycloakSsoSettings;
