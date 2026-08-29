'use client';

/**
 * Vault-wide audit log screen (EE-only, Pro tier, flag-gated).
 *
 * Gating mirrors CredentialsScreen: `release-v1-5-feature` flag, EE edition
 * (implicit — this module is only reachable from EE via the `@enterprise`
 * alias), and `getCredentialsContext` (tier). `credential:audit` is a
 * distinct permission: the screen renders a forbidden state (audit.forbidden)
 * when the viewer can see the vault but not its audit trail, so the tab and
 * this route share one server-provided `canAudit` gate.
 *
 * SECURITY: rows are metadata-only; the action's read-scope already hid
 * activity the viewer may not see, so this screen can never reveal a
 * restricted credential's trail.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import { StringDateRangePicker } from '@alga-psa/ui/components/DateRangePicker';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { KeyRound, RefreshCw } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useFormatters } from '@alga-psa/ui/lib/i18n/client';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { FeatureUpgradeNotice } from '@alga-psa/ui/components/tier-gating/FeatureUpgradeNotice';
import { getAllClients } from '@alga-psa/clients/actions';
import { getAllUsers } from '@alga-psa/user-composition/actions';
import type { IClient, IUserWithRoles } from '@alga-psa/types';
import { FEATURE_MINIMUM_TIER, TIER_FEATURES } from '@alga-psa/types';
import { getCredentialsContext } from '../../lib/actions/credentials/credentialActions';
import type { CredentialsContext } from '../../lib/actions/credentials/credentialActions';
import type { CredentialAuditEventOperation } from '../../lib/actions/credentials/credentialAuditActions';
import { useCredentialAudit, type CredentialAuditFilterState } from './useCredentialAudit';
import { CREDENTIAL_AUDIT_OPERATIONS, useCredentialAuditLabels } from './credentialAuditLabels';

function hasActiveFilters(filters: CredentialAuditFilterState): boolean {
  return Boolean(
    (filters.operations && filters.operations.length > 0)
    || filters.actorUserId
    || filters.clientId
    || filters.from
    || filters.to
  );
}

export function CredentialAuditScreen() {
  const { t } = useTranslation('msp/credentials');
  const releaseFlag = useFeatureFlag('release-v1-5-feature', { defaultValue: false });
  const flagEnabled = typeof releaseFlag === 'boolean' ? releaseFlag : releaseFlag?.enabled ?? false;

  const [context, setContext] = useState<CredentialsContext | null>(null);
  const [clients, setClients] = useState<IClient[]>([]);
  const [users, setUsers] = useState<IUserWithRoles[]>([]);

  const [operations, setOperations] = useState<CredentialAuditEventOperation[]>([]);
  const [actorUserId, setActorUserId] = useState<string>('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const filters = useMemo<CredentialAuditFilterState>(
    () => ({
      operations,
      actorUserId: actorUserId || undefined,
      clientId: clientId ?? undefined,
      from: from ? `${from}T00:00:00.000Z` : undefined,
      to: to ? `${to}T23:59:59.999Z` : undefined,
    }),
    [operations, actorUserId, clientId, from, to]
  );

  const { events, nextCursor, isLoading, loadError, loadMore, refresh } = useCredentialAudit(
    filters,
    context?.tierOk === true && context?.canAudit === true
  );
  const { operationLabel, actorLabel } = useCredentialAuditLabels();
  const { formatDate } = useFormatters();

  const activeFilters = hasActiveFilters(filters);

  useEffect(() => {
    if (!flagEnabled) return;
    let cancelled = false;
    void getCredentialsContext().then((ctx) => {
      if (!cancelled) setContext(ctx);
    }).catch(() => {
      if (!cancelled) setContext({ tierOk: false, huduConnected: false, state: 'unavailable', flagIrrelevantHere: true, canAudit: false });
    });
    return () => {
      cancelled = true;
    };
  }, [flagEnabled]);

  useEffect(() => {
    if (!flagEnabled) return;
    let cancelled = false;
    getAllClients(false)
      .then((list) => {
        if (!cancelled) setClients(list);
      })
      .catch(() => undefined);
    getAllUsers(false, 'internal')
      .then((list) => {
        if (!cancelled) setUsers(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [flagEnabled]);

  const toggleOperation = useCallback((operation: CredentialAuditEventOperation) => {
    setOperations((prev) =>
      prev.includes(operation) ? prev.filter((op) => op !== operation) : [...prev, operation]
    );
  }, []);

  const clearFilters = useCallback(() => {
    setOperations([]);
    setActorUserId('');
    setClientId(null);
    setFrom('');
    setTo('');
  }, []);

  if (!flagEnabled) {
    return null;
  }

  if (!context) {
    return (
      <p id="credentials-audit-loading" className="text-sm text-[rgb(var(--color-text-500))]">
        {t('credentials.audit.loading')}
      </p>
    );
  }

  if (!context.tierOk) {
    if (context.state === 'forbidden') {
      return (
        <Alert id="credentials-audit-forbidden">
          <AlertDescription>{t('credentials.audit.forbidden')}</AlertDescription>
        </Alert>
      );
    }
    if (context.state === 'unavailable') {
      return (
        <Alert id="credentials-audit-unavailable" variant="destructive">
          <AlertDescription>{t('credentials.screen.unavailable')}</AlertDescription>
        </Alert>
      );
    }
    return (
      <div id="credentials-audit-tier">
        <FeatureUpgradeNotice
          featureName={t('credentials.screen.tierFeatureName')}
          requiredTier={FEATURE_MINIMUM_TIER[TIER_FEATURES.CREDENTIALS]}
          description={t('credentials.screen.tierDescription')}
        />
      </div>
    );
  }

  if (!context.canAudit) {
    return (
      <Alert id="credentials-audit-forbidden">
        <AlertDescription>{t('credentials.audit.forbidden')}</AlertDescription>
      </Alert>
    );
  }

  const credentialCell = (credentialId: string, credentialName: string | null): string => {
    if (credentialName) return credentialName;
    if (credentialId.startsWith('hudu:')) return t('credentials.audit.huduCredential');
    return t('credentials.audit.deletedCredential');
  };

  return (
    <div id="credentials-audit-screen" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-[rgb(var(--color-text-500))]">
          <KeyRound className="h-4 w-4 shrink-0" />
          <span>{t('credentials.audit.pageTitle')}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activeFilters && (
            <Button id="credentials-audit-clear-filters" variant="ghost" size="sm" onClick={clearFilters}>
              {t('credentials.audit.clearFilters')}
            </Button>
          )}
          <Button
            id="credentials-audit-refresh"
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={isLoading}
            aria-label={t('credentials.screen.refresh')}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <Card id="credentials-audit-filters">
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-[rgb(var(--color-text-700))]">
              {t('credentials.audit.filter.operation')}
            </span>
            <div id="credentials-audit-operation-filters" className="flex flex-wrap items-center gap-2">
              {CREDENTIAL_AUDIT_OPERATIONS.map((operation) => {
                const checked = operations.includes(operation);
                return (
                  <label
                    key={operation}
                    className={`flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs ${
                      checked
                        ? 'border-[rgb(var(--color-primary-400))] bg-primary-50 text-[rgb(var(--color-primary-700))] dark:bg-primary-500/20'
                        : 'border-[rgb(var(--color-border-200))] text-[rgb(var(--color-text-500))]'
                    }`}
                  >
                    <input
                      id={`credentials-audit-operation-${operation}`}
                      type="checkbox"
                      className="h-3.5 w-3.5"
                      checked={checked}
                      onChange={() => toggleOperation(operation)}
                    />
                    <span className="sr-only">{t('credentials.audit.filter.operation')}</span>
                    {operationLabel(operation)}
                  </label>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-[rgb(var(--color-text-700))]">
                {t('credentials.audit.filter.actor')}
              </span>
              <select
                id="credentials-audit-actor-filter"
                className="h-9 rounded-md border border-[rgb(var(--color-border-200))] px-2 text-sm"
                value={actorUserId}
                onChange={(event) => setActorUserId(event.target.value)}
              >
                <option value="">{t('credentials.audit.filter.allActors')}</option>
                {users.map((user) => (
                  <option key={user.user_id} value={user.user_id}>
                    {[user.first_name, user.last_name].filter(Boolean).join(' ') || user.username}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-[rgb(var(--color-text-700))]">
                {t('credentials.audit.filter.client')}
              </span>
              <ClientPicker
                id="credentials-audit-client-filter"
                clients={clients}
                selectedClientId={clientId}
                onSelect={setClientId}
                fitContent
                placeholder={t('credentials.audit.filter.allClients')}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-[rgb(var(--color-text-700))]">
                {t('credentials.audit.filter.dateRange')}
              </span>
              <StringDateRangePicker
                id="credentials-audit-date-range"
                value={{ from, to }}
                onChange={(range) => {
                  setFrom(range.from);
                  setTo(range.to);
                }}
                fromPlaceholder={t('credentials.audit.filter.fromDate')}
                toPlaceholder={t('credentials.audit.filter.toDate')}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {loadError && (
        <Alert id="credentials-audit-error" variant="destructive">
          <AlertDescription>{t('credentials.audit.error')}</AlertDescription>
        </Alert>
      )}

      <Card id="credentials-audit-table">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 shrink-0" />
            {t('credentials.audit.pageTitle')}
            <Badge id="credentials-audit-count" variant="secondary">
              {events?.length ?? 0}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && !events ? (
            <p id="credentials-audit-loading" className="text-sm text-[rgb(var(--color-text-500))]">
              {t('credentials.audit.loading')}
            </p>
          ) : events && events.length === 0 ? (
            <p id="credentials-audit-empty" className="text-sm text-[rgb(var(--color-text-500))] py-1">
              {activeFilters ? t('credentials.audit.emptyFiltered') : t('credentials.audit.empty')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('credentials.audit.col.when')}</TableHead>
                    <TableHead>{t('credentials.audit.col.who')}</TableHead>
                    <TableHead>{t('credentials.audit.col.action')}</TableHead>
                    <TableHead>{t('credentials.audit.col.credential')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(events ?? []).map((event) => {
                    const when = new Date(event.timestamp);
                    const whenLabel = Number.isNaN(when.getTime())
                      ? event.timestamp
                      : formatDate(when, { dateStyle: 'medium', timeStyle: 'medium' });
                    return (
                      <TableRow key={event.auditId}>
                        <TableCell className="whitespace-nowrap text-xs text-[rgb(var(--color-text-500))]">
                          {whenLabel}
                        </TableCell>
                        <TableCell className="text-sm text-[rgb(var(--color-text-900))]">
                          {actorLabel(event.actor)}
                        </TableCell>
                        <TableCell className="text-sm text-[rgb(var(--color-text-700))]">
                          {operationLabel(event.operation, event.entity?.type)}
                        </TableCell>
                        <TableCell className="text-sm text-[rgb(var(--color-text-700))]">
                          {credentialCell(event.credentialId, event.credentialName)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {nextCursor !== null && (
            <div className="mt-3 flex justify-center">
              <Button
                id="credentials-audit-load-more"
                variant="outline"
                size="sm"
                onClick={() => void loadMore()}
                disabled={isLoading}
              >
                {t('credentials.audit.loadMore')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default CredentialAuditScreen;
