'use client';

import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@alga-psa/ui/components/Card';
import { Switch } from '@alga-psa/ui/components/Switch';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useTierFeature } from 'server/src/context/TierContext';
import { TIER_FEATURES } from '@alga-psa/types';

import {
  createScimConnection,
  getScimProvisioningOverview,
  revokeScimToken,
  rotateScimToken,
  setScimConnectionEnabled,
  unlinkScimUser,
  type ScimProvisioningOverview,
} from '@ee/lib/scim/adminActions';

function statusTone(ok: boolean): string {
  return ok
    ? 'border-[rgb(var(--badge-success-border))] bg-[rgb(var(--badge-success-bg))] text-[rgb(var(--badge-success-text))]'
    : 'border-[rgb(var(--badge-warning-border))] bg-[rgb(var(--badge-warning-bg))] text-[rgb(var(--badge-warning-text))]';
}

export default function ScimProvisioningSettings(): React.JSX.Element {
  const { t } = useTranslation('msp/profile');
  const { formatDate } = useFormatters();
  const hasTierAccess = useTierFeature(TIER_FEATURES.SCIM_PROVISIONING);
  const [overview, setOverview] = React.useState<ScimProvisioningOverview | null>(null);
  const [oneTimeToken, setOneTimeToken] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const loadOverview = React.useCallback(async () => {
    if (!hasTierAccess) {
      setLoading(false);
      return;
    }
    try {
      setError(null);
      setOverview(await getScimProvisioningOverview());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('security.scim.errors.load', {
        defaultValue: 'Unable to load SCIM provisioning.',
      }));
    } finally {
      setLoading(false);
    }
  }, [hasTierAccess, t]);

  React.useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const mutate = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await loadOverview();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('security.scim.errors.update', {
        defaultValue: 'Unable to update SCIM provisioning.',
      }));
    } finally {
      setBusy(false);
    }
  };

  if (!hasTierAccess) {
    return (
      <Card id="scim-upgrade-card" className="overflow-hidden">
        <div className="h-1 bg-[rgb(var(--color-primary-400))]" />
        <CardHeader>
          <CardTitle>{t('security.scim.upgrade.title', { defaultValue: 'Directory lifecycle provisioning' })}</CardTitle>
          <CardDescription>
            {t('security.scim.upgrade.description', {
              defaultValue: 'SCIM user provisioning is available on Pro and higher plans.',
            })}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="py-16" role="status">
        <LoadingIndicator
          layout="stacked"
          text={t('security.scim.loading', { defaultValue: 'Loading user provisioning' })}
        />
      </div>
    );
  }

  const connection = overview?.connection ?? null;
  const endpoint = connection && typeof window !== 'undefined'
    ? `${window.location.origin}${connection.endpointPath}`
    : connection?.endpointPath ?? '';

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-[rgb(var(--color-primary-100))] p-2 text-[rgb(var(--color-primary-600))] dark:bg-[rgb(var(--color-primary-400)/0.22)]">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
              {t('security.scim.title', { defaultValue: 'User provisioning' })}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-[rgb(var(--color-text-600))]">
              {t('security.scim.description', {
                defaultValue: 'Let Microsoft Entra deactivate and reactivate existing internal users. Alga remains authoritative for profiles, roles, teams, and licenses.',
              })}
            </p>
          </div>
        </div>
        {connection && (
          <span className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${statusTone(connection.enabled)}`}>
            {connection.enabled ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            {connection.enabled
              ? t('security.scim.status.enabled', { defaultValue: 'Accepting requests' })
              : t('security.scim.status.disabled', { defaultValue: 'Provisioning paused' })}
          </span>
        )}
      </div>

      {error && (
        <div
          className="rounded-md border border-[rgb(var(--badge-error-border))] bg-[rgb(var(--badge-error-bg))] px-4 py-3 text-sm text-[rgb(var(--badge-error-text))]"
          role="alert"
        >
          {error}
        </div>
      )}

      {!connection ? (
        <Card id="scim-setup-card">
          <CardHeader>
            <CardTitle>{t('security.scim.setup.title', { defaultValue: 'Connect Microsoft Entra' })}</CardTitle>
            <CardDescription>
              {t('security.scim.setup.description', {
                defaultValue: 'Generate a tenant-specific endpoint and one-time bearer token. No Alga users are created by SCIM.',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              id="create-scim-connection-button"
              disabled={busy}
              onClick={() => void mutate(async () => {
                const result = await createScimConnection();
                setOneTimeToken(result.token);
              })}
            >
              <KeyRound className="mr-2 h-4 w-4" />
              {t('security.scim.setup.create', { defaultValue: 'Generate connection' })}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.55fr)]">
            <Card id="scim-connection-card">
              <CardHeader>
                <CardTitle>{t('security.scim.connection.title', { defaultValue: 'Entra connection' })}</CardTitle>
                <CardDescription>
                  {t('security.scim.connection.description', {
                    defaultValue: 'Use these values in the Provisioning section of your Entra enterprise application.',
                  })}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-[rgb(var(--color-text-500))]">
                    {t('security.scim.connection.url', { defaultValue: 'Tenant URL' })}
                  </div>
                  <div className="flex gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] px-3 py-2 text-sm">
                      {endpoint}
                    </code>
                    <Button
                      id="copy-scim-endpoint-button"
                      variant="outline"
                      aria-label={t('security.scim.connection.copyUrl', { defaultValue: 'Copy tenant URL' })}
                      onClick={() => void navigator.clipboard.writeText(endpoint)}
                    >
                      <Clipboard className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {oneTimeToken && (
                  <div className="rounded-md border border-[rgb(var(--badge-warning-border))] bg-[rgb(var(--badge-warning-bg))] p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[rgb(var(--badge-warning-text))]">
                      <KeyRound className="h-4 w-4" />
                      {t('security.scim.connection.oneTimeToken', { defaultValue: 'Copy this token now' })}
                    </div>
                    <p className="my-2 text-xs text-[rgb(var(--badge-warning-text))]">
                      {t('security.scim.connection.oneTimeWarning', {
                        defaultValue: 'For security, Alga cannot show this value again.',
                      })}
                    </p>
                    <div className="flex gap-2">
                      <code className="min-w-0 flex-1 break-all rounded bg-[rgb(var(--color-card))] px-3 py-2 text-xs text-[rgb(var(--color-text-800))]">
                        {oneTimeToken}
                      </code>
                      <Button
                        id="copy-scim-token-button"
                        variant="outline"
                        onClick={() => void navigator.clipboard.writeText(oneTimeToken)}
                      >
                        <Clipboard className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button
                    id="rotate-scim-token-button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void mutate(async () => {
                      const result = await rotateScimToken();
                      setOneTimeToken(result.token);
                    })}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {t('security.scim.connection.rotate', { defaultValue: 'Rotate token' })}
                  </Button>
                  {connection.hasPreviousToken && (
                    <Button
                      id="revoke-previous-scim-token-button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void mutate(async () => {
                        await revokeScimToken('previous');
                      })}
                    >
                      {t('security.scim.connection.revokePrevious', { defaultValue: 'End token overlap' })}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card id="scim-health-card">
              <CardHeader>
                <CardTitle>{t('security.scim.health.title', { defaultValue: 'Connection health' })}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div>
                  <div className="text-[rgb(var(--color-text-500))]">{t('security.scim.health.lastRequest', { defaultValue: 'Last authenticated request' })}</div>
                  <div className="font-medium text-[rgb(var(--color-text-800))]">{connection.lastAuthenticatedAt ? formatDate(connection.lastAuthenticatedAt, { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</div>
                </div>
                <div>
                  <div className="text-[rgb(var(--color-text-500))]">{t('security.scim.health.lastSuccess', { defaultValue: 'Last success' })}</div>
                  <div className="font-medium text-[rgb(var(--color-text-800))]">{connection.lastSuccessAt ? formatDate(connection.lastSuccessAt, { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</div>
                </div>
                <div>
                  <div className="text-[rgb(var(--color-text-500))]">{t('security.scim.health.tokenAge', { defaultValue: 'Current token created' })}</div>
                  <div className="font-medium text-[rgb(var(--color-text-800))]">{connection.tokenCreatedAt ? formatDate(connection.tokenCreatedAt, { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</div>
                </div>
                {connection.lastErrorCode && (
                  <div>
                    <div className="text-[rgb(var(--color-text-500))]">{t('security.scim.health.lastError', { defaultValue: 'Last error' })}</div>
                    <div className="font-mono text-xs text-[rgb(var(--badge-error-text))]">{connection.lastErrorCode}</div>
                  </div>
                )}
                <div className="border-t border-[rgb(var(--color-border-200))] pt-4">
                  <Switch
                    id="scim-connection-enabled-switch"
                    label={t('security.scim.connection.enabled', { defaultValue: 'Accept provisioning requests' })}
                    checked={connection.enabled}
                    disabled={busy}
                    onCheckedChange={(enabled) => void mutate(async () => {
                      await setScimConnectionEnabled(enabled);
                    })}
                  />
                  <p className="mt-2 text-xs text-[rgb(var(--color-text-500))]">
                    {t('security.scim.connection.disableWarning', {
                      defaultValue: 'Pausing preserves every link and current user state.',
                    })}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card id="scim-entra-mapping-card">
            <CardHeader>
              <CardTitle>{t('security.scim.mapping.title', { defaultValue: 'Entra attribute mapping' })}</CardTitle>
              <CardDescription>
                {t('security.scim.mapping.description', {
                  defaultValue: 'Keep Entra defaults for userName, externalId, active, names, title, and emails. Only active controls Alga access.',
                })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 text-sm md:grid-cols-3">
                {[
                  [t('security.scim.mapping.match', { defaultValue: 'Initial match' }), t('security.scim.mapping.matchValue', { defaultValue: 'Exact primary email only' })],
                  [t('security.scim.mapping.scope', { defaultValue: 'Provisioning scope' }), t('security.scim.mapping.scopeValue', { defaultValue: 'Assigned users and groups' })],
                  [t('security.scim.mapping.unsupported', { defaultValue: 'Not supported' }), t('security.scim.mapping.unsupportedValue', { defaultValue: 'Groups, passwords, roles, teams' })],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border border-[rgb(var(--color-border-200))] p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-[rgb(var(--color-text-500))]">{label}</div>
                    <div className="mt-1 font-medium text-[rgb(var(--color-text-800))]">{value}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card id="scim-linked-users-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserRoundCheck className="h-5 w-5" />
                {t('security.scim.links.title', { defaultValue: 'Managed users' })}
                <span className="text-sm font-normal text-[rgb(var(--color-text-500))]">({overview?.links.length ?? 0})</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {overview?.links.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-[rgb(var(--color-border-200))] text-xs uppercase tracking-wide text-[rgb(var(--color-text-500))]">
                      <tr>
                        <th className="px-2 py-3">{t('security.scim.links.user', { defaultValue: 'Alga user' })}</th>
                        <th className="px-2 py-3">{t('security.scim.links.directory', { defaultValue: 'Directory identity' })}</th>
                        <th className="px-2 py-3">{t('security.scim.links.state', { defaultValue: 'State' })}</th>
                        <th className="px-2 py-3 text-right">{t('security.scim.links.action', { defaultValue: 'Action' })}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[rgb(var(--color-border-100))]">
                      {overview.links.map((link) => (
                        <tr key={link.linkId}>
                          <td className="px-2 py-3">
                            <div className="font-medium text-[rgb(var(--color-text-800))]">{link.algaName}</div>
                            <div className="text-xs text-[rgb(var(--color-text-500))]">{link.algaEmail}</div>
                          </td>
                          <td className="px-2 py-3">
                            <div>{link.directoryEmail ?? link.directoryUserName}</div>
                            {link.hasEmailDrift && (
                              <div className="text-xs text-[rgb(var(--badge-warning-text))]">
                                {t('security.scim.links.drift', { defaultValue: 'Email drift' })}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-3">
                            <div>{link.upstreamActive ? t('security.scim.links.active', { defaultValue: 'Upstream active' }) : t('security.scim.links.inactive', { defaultValue: 'Upstream inactive' })}</div>
                            <div className="text-xs text-[rgb(var(--color-text-500))]">
                              {link.effectiveActive ? t('security.scim.links.accessOn', { defaultValue: 'Access enabled' }) : t('security.scim.links.accessOff', { defaultValue: 'Access disabled' })}
                            </div>
                          </td>
                          <td className="px-2 py-3 text-right">
                            <Button
                              id={`unlink-scim-user-${link.linkId}`}
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => void mutate(async () => {
                                await unlinkScimUser(link.linkId);
                              })}
                            >
                              {t('security.scim.links.unlink', { defaultValue: 'Unlink' })}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-md border border-dashed border-[rgb(var(--color-border-300))] p-5 text-sm text-[rgb(var(--color-text-600))]">
                  <UsersRound className="h-5 w-5" />
                  {t('security.scim.links.empty', { defaultValue: 'No directory identities have linked yet.' })}
                </div>
              )}
            </CardContent>
          </Card>

          {Boolean(overview?.unresolved.length) && (
            <Card id="scim-unresolved-identities-card">
              <CardHeader>
                <CardTitle>{t('security.scim.unresolved.title', { defaultValue: 'Needs review' })}</CardTitle>
                <CardDescription>
                  {t('security.scim.unresolved.description', {
                    defaultValue: 'These identities were rejected without changing an Alga user.',
                  })}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {overview?.unresolved.map((identity) => (
                  <div key={identity.unresolvedId} className="flex flex-col justify-between gap-2 rounded-md border border-[rgb(var(--color-border-200))] p-3 md:flex-row md:items-center">
                    <div>
                      <div className="font-medium text-[rgb(var(--color-text-800))]">{identity.displayName ?? identity.userName}</div>
                      <div className="text-xs text-[rgb(var(--color-text-500))]">
                        {identity.primaryEmail ?? identity.userName}
                        {' · '}
                        {identity.upstreamActive
                          ? t('security.scim.state.active', { defaultValue: 'Active upstream' })
                          : t('security.scim.state.inactive', { defaultValue: 'Inactive upstream' })}
                      </div>
                    </div>
                    <div className="font-mono text-xs text-[rgb(var(--badge-warning-text))]">{identity.failureReason}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
