'use client';

/**
 * Credentials vault list screen (EE-only, Pro tier).
 *
 * Gating: `release-v1-5-feature` flag, EE edition (implicit — this module is
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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Input } from '@alga-psa/ui/components/Input';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import {
  ArrowLeft,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  KeyRound,
  Link2,
  Lock,
  RefreshCw,
  Timer,
  Trash2,
  Unlink,
  Pencil,
  Plus,
  Users,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { FeatureUpgradeNotice } from '@alga-psa/ui/components/tier-gating/FeatureUpgradeNotice';
import { getAllClients } from '@alga-psa/clients/actions';
import type { IClient } from '@alga-psa/types';
import { FEATURE_MINIMUM_TIER, TIER_FEATURES } from '@alga-psa/types';
import {
  addCredentialToEntity,
  createCredential,
  deleteCredential,
  removeCredentialFromEntity,
  updateCredential,
} from '../../lib/actions/credentials/credentialActions';
import type { CredentialSaveResult } from '../../lib/actions/credentials/credentialActions';
import type {
  CredentialAssociationEntityType,
  CredentialSummary,
} from '../../lib/credentials/contracts';
import { CredentialFormDialog, type CredentialFormValue } from './CredentialFormDialog';
import { CredentialLinkDialog } from './CredentialLinkDialog';
import { CredentialRestrictDialog } from './CredentialRestrictDialog';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { TotpCountdown } from './TotpCountdown';
import { useCredentialsList, type RevealErrorKey } from './useCredentialsList';

export interface CredentialsScreenProps {
  /** When set, scope the list to one client (unified client Passwords tab). */
  clientId?: string;
  /**
   * When set with `entityId`, scope the list to an entity's attached
   * credentials (association-driven, both sources). Generalized from the v1
   * asset-only scoping.
   */
  entityType?: CredentialAssociationEntityType;
  entityId?: string;
  /**
   * When set with `entityType`/`entityId`, prefill the create dialog's owning
   * client AND filter the link-existing picker to credentials compatible with
   * the same-client rule (the entity's owning client for client-bound types).
   */
  defaultClientId?: string | null;
}

/**
 * List container: the global screen needs its own titled Card on a bare
 * page; an entity embed already sits inside a titled section shell, so a
 * second Card there is a border around a border restating the same title.
 */
function ListChrome({
  entityScoped,
  title,
  count,
  children,
}: {
  entityScoped: boolean;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (entityScoped) {
    return (
      <ul id="credentials-screen-list" className="divide-y divide-[rgb(var(--color-border-100))]">
        {children}
      </ul>
    );
  }
  return (
    <Card id="credentials-screen-list">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4 shrink-0" />
          {title}
          <Badge id="credentials-screen-count" variant="secondary">
            {count}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-[rgb(var(--color-border-100))]">{children}</ul>
      </CardContent>
    </Card>
  );
}

export function CredentialsScreen({ clientId, entityType, entityId, defaultClientId }: CredentialsScreenProps) {
  const { t } = useTranslation('msp/credentials');
  const releaseFlag = useFeatureFlag('release-v1-5-feature', { defaultValue: false });
  const flagEnabled = typeof releaseFlag === 'boolean' ? releaseFlag : releaseFlag?.enabled ?? false;

  const entityScoped = Boolean(entityType && entityId);

  const [clients, setClients] = useState<IClient[]>([]);

  // Load + reveal state lives in the shared hook (single home for the
  // security-sensitive reveal handling; the bento tile body uses it too).
  const {
    context,
    credentials,
    isLoading,
    isRefreshing,
    loadError,
    load,
    refresh: handleRefresh,
    revealedValues,
    revealingIds,
    revealErrors,
    reveal: handleReveal,
    hide: handleHide,
    copyPassword: handleCopy,
    copyOtp: handleCopyOtp,
  } = useCredentialsList({ enabled: flagEnabled, clientId, entityType, entityId });

  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CredentialSummary | null>(null);
  const [restrictTarget, setRestrictTarget] = useState<CredentialSummary | null>(null);
  // Entity embeds swap the body between views instead of stacking overlay
  // dialogs (the embed often already lives inside the tile's manager dialog,
  // and a dialog on a dialog reads as broken chrome).
  const [entityView, setEntityView] = useState<'list' | 'attach' | 'create'>('list');
  const inlineFormRequestClose = useRef<(() => void) | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{
    kind: 'detach' | 'delete';
    credential: CredentialSummary;
  } | null>(null);

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
    if (context?.huduConnected !== true && sourceFilter === 'hudu') setSourceFilter('all');
  }, [context?.huduConnected, sourceFilter]);

  // Tenant client list backs the global screen's client filter and row
  // labels. Entity embeds never render either (the scope already fixes the
  // client), so skip the fetch there; the form dialog self-fetches when it
  // needs a picker.
  useEffect(() => {
    if (!flagEnabled || entityScoped) return;
    let cancelled = false;
    getAllClients(false)
      .then((list) => {
        if (!cancelled) setClients(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [flagEnabled, entityScoped]);

  const handleFormSubmit = async (value: CredentialFormValue) => {
    let result: CredentialSaveResult;
    if (editing) {
      result = await updateCredential(editing.id, {
        clientId: value.clientId,
        name: value.name,
        username: value.username,
        password: value.password,
        otpSecret: value.otpSecret,
        url: value.url,
        description: value.description,
      });
    } else {
      result = await createCredential({
        destination: value.destination,
        clientId: value.clientId,
        name: value.name,
        username: value.username,
        password: value.password ?? null,
        otpSecret: value.otpSecret ?? null,
        url: value.url,
        description: value.description,
        attachments: value.attachments,
      });
    }
    if (result.ok === false) return result;
    setFormOpen(false);
    setEditing(null);
    setEntityView('list');
    await load();
    return result;
  };

  const handleLink = async (credential: CredentialSummary) => {
    if (!entityType || !entityId) return;
    await addCredentialToEntity(entityType, entityId, credential.id);
    setEntityView('list');
    await load();
  };

  const handleDetach = (credential: CredentialSummary) => {
    setConfirmTarget({ kind: 'detach', credential });
  };

  const handleDelete = (credential: CredentialSummary) => {
    setConfirmTarget({ kind: 'delete', credential });
  };

  const handleConfirm = async () => {
    if (!confirmTarget) return;
    const { kind, credential } = confirmTarget;
    setConfirmTarget(null);
    if (kind === 'detach') {
      if (!entityType || !entityId) return;
      try {
        await removeCredentialFromEntity(entityType, entityId, credential.id);
        await load();
      } catch {
        toast.error(t('credentials.screen.detachFailed'));
      }
    } else {
      try {
        await deleteCredential(credential.id, credential.clientId);
        await load();
      } catch {
        toast.error(t('credentials.screen.deleteFailed'));
      }
    }
  };

  const handleRestrictSaved = async () => {
    setRestrictTarget(null);
    await load();
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
      <p id="credentials-screen-loading" className="text-sm text-[rgb(var(--color-text-500))]">
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
    <div id="credentials-screen" className={entityScoped ? 'space-y-3' : 'space-y-4'}>
      {(!entityScoped || entityView === 'list') && (
        <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* The vault subtitle, search, and filters are global-screen chrome:
            an entity embed's scope already fixes the client and the list is
            association-driven (a handful of rows), so none of them inform. */}
        {!entityScoped && (
          <div className="flex items-center gap-2 text-sm text-[rgb(var(--color-text-500))]">
            <KeyRound className="h-4 w-4 shrink-0" />
            <span>{t('credentials.screen.subtitle')}</span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            id="credentials-screen-new"
            size="sm"
            onClick={() => {
              setEditing(null);
              if (entityScoped) {
                setEntityView('create');
              } else {
                setFormOpen(true);
              }
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t('credentials.screen.newPassword')}
          </Button>
          {entityScoped && (
            <Button
              id="credentials-screen-link"
              variant="outline"
              size="sm"
              onClick={() => setEntityView('attach')}
            >
              <Link2 className="mr-2 h-4 w-4" />
              {t('credentials.screen.linkExisting')}
            </Button>
          )}
          {!entityScoped && (
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
          )}
        </div>
      </div>

      {!entityScoped && (
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
              className="h-9 rounded-md border border-[rgb(var(--color-border-200))] px-2 text-sm"
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
            className="h-9 rounded-md border border-[rgb(var(--color-border-200))] px-2 text-sm"
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value)}
          >
            <option value="all">{t('credentials.screen.allSources')}</option>
            <option value="alga">{t('credentials.screen.sourceAlga')}</option>
            {context?.huduConnected === true && <option value="hudu">{t('credentials.screen.sourceHudu')}</option>}
          </select>
        </div>
      )}

      {loadError && (
        <Alert id="credentials-screen-error" variant="destructive">
          <AlertDescription>{t('credentials.screen.error')}</AlertDescription>
        </Alert>
      )}

      {credentials && visibleRows.length === 0 && (
        entityScoped ? (
          <p id="credentials-screen-empty" className="text-sm text-[rgb(var(--color-text-500))] py-1">
            {t('credentials.section.empty')}
          </p>
        ) : (
          <Card id="credentials-screen-empty">
            <CardContent>
              <p className="text-sm text-[rgb(var(--color-text-500))]">
                {search || clientFilter !== 'all' || sourceFilter !== 'all'
                  ? t('credentials.screen.empty')
                  : t('credentials.screen.emptyNoFilters')}
              </p>
            </CardContent>
          </Card>
        )
      )}

      {visibleRows.length > 0 && (
        <ListChrome entityScoped={entityScoped} title={t('credentials.pageTitle')} count={visibleRows.length}>
              {visibleRows.map((item) => {
                const id = item.id;
                const revealed = revealedValues[id];
                const errorKey = revealErrors[id];
                return (
                  <li key={id} className="flex items-start justify-between gap-4 py-2">
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="flex items-center gap-2 font-medium text-[rgb(var(--color-text-900))]">
                        <span id={`credentials-row-name-${id}`}>{item.name}</span>
                        {/* Badge the marked case only: native vault rows are
                            the default and a label on every row marks nothing. */}
                        {item.source === 'hudu' && (
                          <Badge variant="secondary" id={`credentials-row-source-${id}`}>
                            {t('credentials.screen.sourceHudu')}
                          </Badge>
                        )}
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
                        <span id={`credentials-row-username-${id}`} className="text-xs text-[rgb(var(--color-text-500))]">
                          {item.username}
                        </span>
                      )}
                      {/* Only informative when the surface spans clients: the
                          client tab and client-bound entity embeds already fix
                          the client, so the label would repeat the page. */}
                      {!clientId && !defaultClientId && (item.clientName ?? clientName(item.clientId)) && (
                        <span id={`credentials-row-client-${id}`} className="text-xs text-[rgb(var(--color-text-500))]">
                          {item.clientName ?? clientName(item.clientId)}
                        </span>
                      )}
                      {revealed && (
                        <div className="flex flex-wrap items-center gap-2">
                          {revealed.password !== '' && (
                            <code
                              id={`credentials-row-value-${id}`}
                              className="rounded bg-[rgb(var(--color-border-100))] px-2 py-1 font-mono text-sm text-[rgb(var(--color-text-900))]"
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
                          className="text-xs text-red-600 dark:text-red-400"
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
                      {revealed !== undefined && revealed.password !== '' && (
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
                      {!entityScoped && (
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
                      {!entityScoped && item.source === 'alga' && (
                        <Button
                          id={`credentials-row-restrict-${id}`}
                          variant="ghost"
                          size="sm"
                          onClick={() => setRestrictTarget(item)}
                        >
                          <Users className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {!entityScoped && (
                        <Button
                          id={`credentials-row-delete-${id}`}
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(item)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500 dark:text-red-400" />
                        </Button>
                      )}
                      {entityScoped && (
                        <Button
                          id={`credentials-row-detach-${id}`}
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDetach(item)}
                        >
                          <Unlink className="h-3.5 w-3.5 text-red-500 dark:text-red-400" />
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
        </ListChrome>
      )}
        </>
      )}

      {/* Swapped-in views for entity embeds: back affordance + heading, then
          the picker/form content in place of the list. */}
      {entityScoped && entityView !== 'list' && (
        <div id="credentials-screen-subview" className="space-y-3">
          <div className="flex items-center gap-2">
            <Button
              id="credentials-screen-back"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              aria-label={t('credentials.screen.back')}
              title={t('credentials.screen.back')}
              onClick={() => entityView === 'create' ? inlineFormRequestClose.current?.() : setEntityView('list')}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h3 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
              {entityView === 'attach' ? t('credentials.link.title') : t('credentials.form.title')}
            </h3>
          </div>
          {entityView === 'attach' ? (
            <CredentialLinkDialog
              inline
              isOpen
              onClose={() => setEntityView('list')}
              clientId={defaultClientId ?? clientId ?? null}
              excludeCredentialIds={credentials?.map((c) => c.id) ?? []}
              onSelect={handleLink}
            />
          ) : (
            <CredentialFormDialog
              inline
              isOpen
              onClose={() => setEntityView('list')}
              onSubmit={handleFormSubmit}
              editing={null}
              defaultClientId={defaultClientId ?? clientId ?? null}
              clients={clients}
              entityType={entityType ?? null}
              entityId={entityId ?? null}
              context={context}
              onRequestClose={(requestClose) => { inlineFormRequestClose.current = requestClose; }}
            />
          )}
        </div>
      )}

      {/* Global/client-tab surfaces keep the conventional overlay dialog. */}
      {!entityScoped && (
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
          entityType={entityType ?? null}
          entityId={entityId ?? null}
          context={context}
        />
      )}

      <CredentialRestrictDialog
        credential={restrictTarget}
        onClose={() => setRestrictTarget(null)}
        onSaved={handleRestrictSaved}
      />

      <ConfirmationDialog
        id="credentials-confirm-dialog"
        isOpen={confirmTarget !== null}
        onClose={() => setConfirmTarget(null)}
        onConfirm={handleConfirm}
        title={t(
          confirmTarget?.kind === 'detach'
            ? 'credentials.screen.confirmDetachTitle'
            : 'credentials.screen.confirmDeleteTitle'
        )}
        message={t(
          confirmTarget?.kind === 'detach'
            ? 'credentials.screen.confirmDetach'
            : 'credentials.screen.confirmDelete',
          { name: confirmTarget?.credential.name ?? '' }
        )}
        confirmLabel={
          confirmTarget?.kind === 'detach' ? t('credentials.screen.detach') : t('credentials.table.delete')
        }
      />
    </div>
  );
}

export default CredentialsScreen;
