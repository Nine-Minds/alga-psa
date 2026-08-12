'use client';

/**
 * Credentials vault list screen (EE-only, Pro tier).
 *
 * Gating: `release-v1.5-feature` flag, EE edition (implicit — this module is
 * only reachable from EE via the `@enterprise` alias), and `getCredentialsContext`
 * (tier). Off ⇒ renders nothing, so the nav-less flag-off state is preserved.
 *
 * SECURITY (NFR1): list payloads are metadata-only. Revealed values live ONLY in
 * transient component state keyed by row id — cleared on Hide, on Refresh, and
 * gone on unmount — and are never logged, cached, or persisted client-side.
 * Every reveal round-trips the server (no value caching).
 *
 * This screen is the shared list body for the global `/msp/credentials` screen
 * and the unified client Passwords tab (`clientId` scopes it).
 */

import React, { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Input } from '@alga-psa/ui/components/Input';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import {
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  KeyRound,
  Lock,
  RefreshCw,
  Timer,
  Trash2,
  Pencil,
  Plus,
  Users,
} from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { FeatureUpgradeNotice } from '@alga-psa/ui/components/tier-gating/FeatureUpgradeNotice';
import { getAllClients } from '@alga-psa/clients/actions';
import type { IClient } from '@alga-psa/types';
import { FEATURE_MINIMUM_TIER, TIER_FEATURES } from '@alga-psa/types';
import {
  createCredential,
  deleteCredential,
  getCredentialsContext,
  listCredentials,
  revealCredential,
  updateCredential,
} from '../../lib/actions/credentials/credentialActions';
import type { CredentialsContext } from '../../lib/actions/credentials/credentialActions';
import type { CredentialRevealResult, CredentialSummary } from '../../lib/credentials/contracts';
import { CredentialFormDialog, type CredentialFormValue } from './CredentialFormDialog';
import { CredentialRestrictDialog } from './CredentialRestrictDialog';
import { TotpCountdown } from './TotpCountdown';

export interface CredentialsScreenProps {
  /** When set, scope the list to one client (unified client Passwords tab). */
  clientId?: string;
  /** When set, scope the list to an asset's attached credentials. */
  assetId?: string;
  /** When set with `assetId`, prefill the create dialog's owning client. */
  defaultClientId?: string | null;
}

type RevealState = {
  password: string;
  otpCode: CredentialRevealResult['otpCode'];
};

type RevealErrorKey = 'failed' | 'noAccess' | 'notFound';

export function CredentialsScreen({ clientId, assetId, defaultClientId }: CredentialsScreenProps) {
  const { t } = useTranslation('msp/credentials');
  const releaseFlag = useFeatureFlag('release-v1.5-feature', { defaultValue: false });
  const flagEnabled = typeof releaseFlag === 'boolean' ? releaseFlag : releaseFlag?.enabled ?? false;

  const [context, setContext] = useState<CredentialsContext | null>(null);
  const [credentials, setCredentials] = useState<CredentialSummary[] | null>(null);
  const [clients, setClients] = useState<IClient[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, startRefreshTransition] = useTransition();
  const [loadError, setLoadError] = useState(false);

  // SECURITY: the only place revealed values ever live.
  const [revealedValues, setRevealedValues] = useState<Record<string, RevealState>>({});
  const [revealingIds, setRevealingIds] = useState<Record<string, boolean>>({});
  const [revealErrors, setRevealErrors] = useState<Record<string, RevealErrorKey>>({});

  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CredentialSummary | null>(null);
  const [restrictTarget, setRestrictTarget] = useState<CredentialSummary | null>(null);

  const load = useCallback(
    async (refresh: boolean) => {
      setLoadError(false);
      setRevealedValues({});
      setRevealErrors({});
      try {
        const ctx = await getCredentialsContext();
        setContext(ctx);
        if (!ctx.tierOk) {
          setCredentials([]);
          return;
        }
        setCredentials(
          await listCredentials({ clientId, assetId, search: refresh ? undefined : undefined })
        );
      } catch {
        setLoadError(true);
      }
    },
    [clientId, assetId]
  );

  const applyFilters = useCallback(
    (items: CredentialSummary[]) => {
      const term = search.trim().toLowerCase();
      return items.filter((item) => {
        if (clientFilter !== 'all' && item.clientId !== clientFilter) return false;
        if (sourceFilter !== 'all' && item.source !== sourceFilter) return false;
        if (term) {
          const haystack = [item.name, item.username, item.url].filter(Boolean).join(' ').toLowerCase();
          if (!haystack.includes(term)) return false;
        }
        return true;
      });
    },
    [search, clientFilter, sourceFilter]
  );

  useEffect(() => {
    if (!flagEnabled) return;
    let cancelled = false;
    setIsLoading(true);
    void load(false).finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [flagEnabled, load]);

  useEffect(() => {
    if (!flagEnabled) return;
    let cancelled = false;
    getAllClients(false)
      .then((list) => {
        if (!cancelled) setClients(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [flagEnabled]);

  const handleRefresh = () => {
    startRefreshTransition(async () => {
      await load(true);
    });
  };

  const handleReveal = async (id: string) => {
    setRevealingIds((prev) => ({ ...prev, [id]: true }));
    setRevealErrors((prev) => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
    try {
      const result = await revealCredential(id);
      if (result.state === 'ok') {
        setRevealedValues((prev) => ({
          ...prev,
          [id]: { password: result.password ?? '', otpCode: result.otpCode ?? null },
        }));
      } else {
        setRevealErrors((prev) => ({
          ...prev,
          [id]:
            result.state === 'no_access'
              ? 'noAccess'
              : result.state === 'not_found'
                ? 'notFound'
                : 'failed',
        }));
      }
    } catch {
      setRevealErrors((prev) => ({ ...prev, [id]: 'failed' }));
    } finally {
      setRevealingIds((prev) => {
        const { [id]: _removed, ...rest } = prev;
        return rest;
      });
    }
  };

  const handleHide = (id: string) => {
    setRevealedValues((prev) => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const handleCopy = (id: string) => {
    const value = revealedValues[id]?.password;
    if (value !== undefined) {
      void navigator.clipboard.writeText(value);
    }
  };

  const handleCopyOtp = (id: string) => {
    const code = revealedValues[id]?.otpCode?.code;
    if (code !== undefined) {
      void navigator.clipboard.writeText(code);
    }
  };

  const handleFormSubmit = async (value: CredentialFormValue) => {
    if (editing) {
      await updateCredential(editing.id, {
        clientId: value.clientId,
        name: value.name,
        username: value.username,
        password: value.password,
        otpSecret: value.otpSecret,
        url: value.url,
        description: value.description,
      });
    } else {
      await createCredential({
        destination: value.destination,
        clientId: value.clientId,
        name: value.name,
        username: value.username,
        password: value.password ?? null,
        otpSecret: value.otpSecret ?? null,
        url: value.url,
        description: value.description,
        assetIds: value.assetIds,
      });
    }
    setFormOpen(false);
    setEditing(null);
    await load(true);
  };

  const handleDelete = async (credential: CredentialSummary) => {
    if (!window.confirm(t('credentials.screen.confirmDelete', { name: credential.name }))) {
      return;
    }
    try {
      await deleteCredential(credential.id, credential.clientId);
      await load(true);
    } catch {
      setLoadError(true);
    }
  };

  const handleRestrictSaved = async () => {
    setRestrictTarget(null);
    await load(true);
  };

  const revealErrorText: Record<RevealErrorKey, string> = {
    failed: t('credentials.table.revealFailed'),
    noAccess: t('credentials.table.revealNoAccess'),
    notFound: t('credentials.table.revealNotFound'),
  };

  const visibleRows = useMemo(
    () => (credentials ? applyFilters(credentials) : []),
    [credentials, applyFilters]
  );

  const clientName = (id: string) =>
    clients.find((client) => client.client_id === id)?.client_name ?? null;

  if (!flagEnabled) {
    return null;
  }

  if (isLoading && !credentials) {
    return (
      <p id="credentials-screen-loading" className="text-sm text-gray-500">
        {t('credentials.screen.loading')}
      </p>
    );
  }

  if (context && !context.tierOk) {
    if (context.state === 'forbidden') {
      return (
        <Alert id="credentials-screen-forbidden">
          <AlertDescription>{t('credentials.screen.noPermission')}</AlertDescription>
        </Alert>
      );
    }
    if (context.state === 'unavailable') {
      return (
        <Alert id="credentials-screen-unavailable" variant="destructive">
          <AlertDescription>{t('credentials.screen.unavailable')}</AlertDescription>
        </Alert>
      );
    }
    // 'tier' (and any legacy context without a state): the standard upgrade
    // boundary, same as every other tier-gated surface.
    return (
      <div id="credentials-screen-tier">
        <FeatureUpgradeNotice
          featureName={t('credentials.screen.tierFeatureName')}
          requiredTier={FEATURE_MINIMUM_TIER[TIER_FEATURES.CREDENTIALS]}
          description={t('credentials.screen.tierDescription')}
        />
      </div>
    );
  }

  return (
    <div id="credentials-screen" className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <KeyRound className="h-4 w-4 shrink-0" />
          <span>{t('credentials.screen.subtitle')}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            id="credentials-screen-new"
            size="sm"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t('credentials.screen.newPassword')}
          </Button>
          <Button
            id="credentials-screen-refresh"
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isLoading || isRefreshing}
            aria-label={t('credentials.screen.refresh')}
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="credentials-screen-search"
          className="max-w-xs"
          placeholder={t('credentials.screen.searchPlaceholder')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {!clientId && (
          <select
            id="credentials-screen-client-filter"
            className="h-9 rounded-md border border-gray-200 px-2 text-sm"
            value={clientFilter}
            onChange={(event) => setClientFilter(event.target.value)}
          >
            <option value="all">{t('credentials.screen.allClients')}</option>
            {clients.map((client) => (
              <option key={client.client_id} value={client.client_id}>
                {client.client_name}
              </option>
            ))}
          </select>
        )}
        <select
          id="credentials-screen-source-filter"
          className="h-9 rounded-md border border-gray-200 px-2 text-sm"
          value={sourceFilter}
          onChange={(event) => setSourceFilter(event.target.value)}
        >
          <option value="all">{t('credentials.screen.allSources')}</option>
          <option value="alga">{t('credentials.screen.sourceAlga')}</option>
          <option value="hudu">{t('credentials.screen.sourceHudu')}</option>
        </select>
      </div>

      {loadError && (
        <Alert id="credentials-screen-error" variant="destructive">
          <AlertDescription>{t('credentials.screen.error')}</AlertDescription>
        </Alert>
      )}

      {credentials && visibleRows.length === 0 && (
        <Card id="credentials-screen-empty">
          <CardContent>
            <p className="text-sm text-gray-500">
              {search || clientFilter !== 'all' || sourceFilter !== 'all'
                ? t('credentials.screen.empty')
                : t('credentials.screen.emptyNoFilters')}
            </p>
          </CardContent>
        </Card>
      )}

      {visibleRows.length > 0 && (
        <Card id="credentials-screen-list">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4 shrink-0" />
              {t('credentials.pageTitle')}
              <Badge id="credentials-screen-count" variant="secondary">
                {visibleRows.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-gray-100">
              {visibleRows.map((item) => {
                const id = item.id;
                const revealed = revealedValues[id];
                const errorKey = revealErrors[id];
                return (
                  <li key={id} className="flex items-start justify-between gap-4 py-2">
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="flex items-center gap-2 font-medium text-gray-900">
                        <span id={`credentials-row-name-${id}`}>{item.name}</span>
                        <Badge variant="secondary" id={`credentials-row-source-${id}`}>
                          {item.source === 'hudu'
                            ? t('credentials.screen.sourceHudu')
                            : t('credentials.screen.sourceAlga')}
                        </Badge>
                        {item.isRestricted && (
                          <Badge variant="warning" id={`credentials-row-restricted-${id}`}>
                            <Lock className="mr-1 h-3 w-3" />
                            {t('credentials.table.restrictedOn')}
                          </Badge>
                        )}
                        {item.hasOtp && (
                          <Badge variant="outline" id={`credentials-row-totp-${id}`}>
                            <Timer className="mr-1 h-3 w-3" />
                            {t('credentials.table.totpOn')}
                          </Badge>
                        )}
                      </span>
                      {item.username && (
                        <span id={`credentials-row-username-${id}`} className="text-xs text-gray-500">
                          {item.username}
                        </span>
                      )}
                      {!clientId && clientName(item.clientId) && (
                        <span id={`credentials-row-client-${id}`} className="text-xs text-gray-500">
                          {clientName(item.clientId)}
                        </span>
                      )}
                      {revealed && (
                        <div className="flex flex-wrap items-center gap-2">
                          {revealed.password !== '' && (
                            <code
                              id={`credentials-row-value-${id}`}
                              className="rounded bg-gray-100 px-2 py-1 font-mono text-sm text-gray-900"
                            >
                              {revealed.password}
                            </code>
                          )}
                          {revealed.otpCode && (
                            <TotpCountdown
                              credentialId={id}
                              initial={{
                                code: revealed.otpCode.code,
                                secondsRemaining: revealed.otpCode.secondsRemaining,
                              }}
                              onCopyCode={() => handleCopyOtp(id)}
                            />
                          )}
                        </div>
                      )}
                      {errorKey && (
                        <span
                          id={`credentials-row-reveal-error-${id}`}
                          role="alert"
                          className="text-xs text-red-600"
                        >
                          {revealErrorText[errorKey]}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {item.externalUrl && (
                        <a
                          id={`credentials-row-open-${id}`}
                          href={item.externalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm text-[rgb(var(--color-primary-600))] hover:underline"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {revealed === undefined ? (
                        <Button
                          id={`credentials-row-reveal-${id}`}
                          variant="outline"
                          size="sm"
                          onClick={() => handleReveal(id)}
                          disabled={revealingIds[id] === true}
                        >
                          <Eye className="mr-1 h-3.5 w-3.5" />
                          {t('credentials.table.reveal')}
                        </Button>
                      ) : (
                        <Button
                          id={`credentials-row-hide-${id}`}
                          variant="outline"
                          size="sm"
                          onClick={() => handleHide(id)}
                        >
                          <EyeOff className="mr-1 h-3.5 w-3.5" />
                          {t('credentials.table.hide')}
                        </Button>
                      )}
                      {revealed?.password !== '' && (
                        <Button
                          id={`credentials-row-copy-${id}`}
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopy(id)}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          {t('credentials.table.copy')}
                        </Button>
                      )}
                      {!assetId && (
                        <Button
                          id={`credentials-row-edit-${id}`}
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditing(item);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {!assetId && item.source === 'alga' && (
                        <Button
                          id={`credentials-row-restrict-${id}`}
                          variant="ghost"
                          size="sm"
                          onClick={() => setRestrictTarget(item)}
                        >
                          <Users className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {!assetId && (
                        <Button
                          id={`credentials-row-delete-${id}`}
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(item)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-600" />
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <CredentialFormDialog
        isOpen={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSubmit={handleFormSubmit}
        editing={editing}
        defaultClientId={defaultClientId ?? clientId ?? null}
        clients={clients}
        assetId={assetId ?? null}
        context={context}
        onError={() => setLoadError(true)}
      />

      <CredentialRestrictDialog
        credential={restrictTarget}
        onClose={() => setRestrictTarget(null)}
        onSaved={handleRestrictSaved}
      />
    </div>
  );
}

export default CredentialsScreen;
