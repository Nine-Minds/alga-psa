'use client';

/**
 * Vault-wide audit log screen (EE-only, Pro tier).
 *
 * Gating mirrors CredentialsScreen: EE edition (implicit — this module is
 * only reachable from EE via the `@enterprise` alias) and
 * `getCredentialsContext` (tier). `credential:audit` is a
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
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import { StringDateRangePicker } from '@alga-psa/ui/components/DateRangePicker';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import { Activity, Eye, KeyRound, PencilLine, RefreshCw, SlidersHorizontal, Users } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useFormatters } from '@alga-psa/ui/lib/i18n/client';
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

const CREDENTIAL_AUDIT_OPERATION_FILTERS = CREDENTIAL_AUDIT_OPERATIONS
  .filter((operation) => operation !== 'hudu_password_reveal')
  .map((operation) => ({
    id: operation,
    operations: operation === 'credential_reveal'
      ? [operation, 'hudu_password_reveal'] as CredentialAuditEventOperation[]
      : [operation],
  }));

const REVEAL_OPERATIONS: CredentialAuditEventOperation[] = [
  'credential_reveal',
  'credential_otp_seed_reveal',
  'hudu_password_reveal',
];

const CHANGE_OPERATIONS: CredentialAuditEventOperation[] = [
  'credential_updated',
  'credential_grants_changed',
];

const OPERATION_BADGE_VARIANTS: Record<CredentialAuditEventOperation, BadgeVariant> = {
  credential_reveal: 'primary',
  credential_otp_seed_reveal: 'info',
  credential_created: 'success',
  credential_updated: 'info',
  credential_deleted: 'error',
  credential_grants_changed: 'warning',
  credential_associated: 'default-muted',
  credential_detached: 'outline',
  hudu_password_reveal: 'primary',
};

interface AuditMetricProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  accentClassName: string;
  iconClassName: string;
}

function AuditMetric({ label, value, icon, accentClassName, iconClassName }: AuditMetricProps) {
  return (
    <Card className={`overflow-hidden border-2 ${accentClassName}`}>
      <CardContent className="!p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-3xl font-semibold tabular-nums tracking-tight text-[rgb(var(--color-text-900))]">
              {value}
            </div>
            <div className="mt-1 text-sm font-medium text-[rgb(var(--color-text-600))]">
              {label}
            </div>
          </div>
          <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${iconClassName}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The date-range picker yields calendar days (`YYYY-MM-DD`) the viewer chose in
 * their own timezone. The audit filter compares against UTC timestamps, so we
 * must anchor each day to the START/END of that *local* day and let
 * `toISOString()` shift it into UTC — not append a literal `Z` boundary, which
 * would treat the local calendar day as if it were a UTC day and leak (or drop)
 * rows by the local UTC offset (e.g. Aug 28 evening rows appearing under an
 * Aug 29 filter in America/New_York).
 */
function localDayBoundaryIso(day: string, edge: 'start' | 'end'): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return undefined;
  const [, year, month, dayOfMonth] = match;
  const date = edge === 'start'
    ? new Date(Number(year), Number(month) - 1, Number(dayOfMonth), 0, 0, 0, 0)
    : new Date(Number(year), Number(month) - 1, Number(dayOfMonth), 23, 59, 59, 999);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

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
      from: from ? localDayBoundaryIso(from, 'start') : undefined,
      to: to ? localDayBoundaryIso(to, 'end') : undefined,
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

  const summary = useMemo(() => {
    const visibleEvents = events ?? [];
    const actors = new Set(
      visibleEvents.map((event) => event.actor.userId ?? event.actor.name ?? 'system')
    );
    return {
      activity: visibleEvents.length,
      reveals: visibleEvents.filter((event) => REVEAL_OPERATIONS.includes(event.operation)).length,
      changes: visibleEvents.filter((event) => CHANGE_OPERATIONS.includes(event.operation)).length,
      actors: actors.size,
    };
  }, [events]);

  useEffect(() => {
    let cancelled = false;
    void getCredentialsContext().then((ctx) => {
      if (!cancelled) setContext(ctx);
    }).catch(() => {
      if (!cancelled) setContext({ tierOk: false, huduConnected: false, state: 'unavailable', flagIrrelevantHere: true, canAudit: false });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
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
  }, []);

  const toggleOperationFilter = useCallback((filterOperations: CredentialAuditEventOperation[]) => {
    setOperations((prev) => {
      const isSelected = filterOperations.every((operation) => prev.includes(operation));
      if (isSelected) {
        return prev.filter((operation) => !filterOperations.includes(operation));
      }
      return [...new Set([...prev, ...filterOperations])];
    });
  }, []);

  const clearFilters = useCallback(() => {
    setOperations([]);
    setActorUserId('');
    setClientId(null);
    setFrom('');
    setTo('');
  }, []);

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
    <div id="credentials-audit-screen" className="space-y-5">
      <Card
        id="credentials-audit-hero"
        className="relative overflow-hidden border-0 bg-primary-900 shadow-lg shadow-primary-900/10"
      >
        <div className="pointer-events-none absolute -right-14 -top-24 h-64 w-64 rounded-full border-[40px] border-white/5" />
        <CardContent className="!p-5 sm:!p-6">
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 text-white ring-1 ring-inset ring-white/20">
                  <KeyRound className="h-6 w-6" />
                </span>
                {t('credentials.audit.pageTitle')}
              </h1>
              <p className="mt-3 text-base text-white/80">
                {t('credentials.audit.subtitle', { defaultValue: 'See who viewed or changed passwords across your vault.' })}
              </p>
            </div>
            <Button
              id="credentials-audit-refresh"
              variant="outline"
              size="sm"
              className="gap-2 border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={() => void refresh()}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              {t('credentials.screen.refresh')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div id="credentials-audit-summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AuditMetric
          label={t('credentials.audit.summary.activity', { defaultValue: 'Activity in view' })}
          value={summary.activity}
          icon={<Activity className="h-5 w-5" />}
          accentClassName="border-[rgb(var(--color-primary-500))]"
          iconClassName="bg-primary-50 text-[rgb(var(--color-primary-600))]"
        />
        <AuditMetric
          label={t('credentials.audit.summary.reveals', { defaultValue: 'Password reveals' })}
          value={summary.reveals}
          icon={<Eye className="h-5 w-5" />}
          accentClassName="border-[rgb(var(--badge-warning-border))]"
          iconClassName="bg-[rgb(var(--badge-warning-bg))] text-[rgb(var(--badge-warning-text))]"
        />
        <AuditMetric
          label={t('credentials.audit.summary.changes', { defaultValue: 'Changes' })}
          value={summary.changes}
          icon={<PencilLine className="h-5 w-5" />}
          accentClassName="border-[rgb(var(--badge-info-border))]"
          iconClassName="bg-[rgb(var(--badge-info-bg))] text-[rgb(var(--badge-info-text))]"
        />
        <AuditMetric
          label={t('credentials.audit.summary.actors', { defaultValue: 'People active' })}
          value={summary.actors}
          icon={<Users className="h-5 w-5" />}
          accentClassName="border-[rgb(var(--badge-success-border))]"
          iconClassName="bg-[rgb(var(--badge-success-bg))] text-[rgb(var(--badge-success-text))]"
        />
      </div>

      <Card id="credentials-audit-filters">
        <CardHeader className="!flex-row !items-center justify-between !space-y-0 border-b border-[rgb(var(--color-border-200))] p-5">
          <CardTitle className="flex items-center gap-2 text-lg">
            <SlidersHorizontal className="h-5 w-5 text-[rgb(var(--color-primary-600))]" />
            <span>
              {t('credentials.audit.filtersTitle', { defaultValue: 'Filters' })}
            </span>
          </CardTitle>
          {activeFilters && (
            <Button id="credentials-audit-clear-filters" variant="ghost" size="sm" onClick={clearFilters}>
              {t('credentials.audit.clearFilters')}
            </Button>
          )}
        </CardHeader>
        <CardContent className="!p-5 space-y-5">
          <div>
            <div className="mb-2 text-sm font-semibold text-[rgb(var(--color-text-700))]">
              {t('credentials.audit.filter.operation')}
            </div>
            <div id="credentials-audit-operation-filters" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {CREDENTIAL_AUDIT_OPERATION_FILTERS.map((filter) => {
                const checked = filter.operations.every((operation) => operations.includes(operation));
                return (
                  <Checkbox
                    key={filter.id}
                    id={`credentials-audit-operation-${filter.id}`}
                    size="sm"
                    checked={checked}
                    onChange={() => toggleOperationFilter(filter.operations)}
                    label={operationLabel(filter.id)}
                    containerClassName={`min-h-10 cursor-pointer rounded-lg border px-3 py-2 [&_label]:text-sm ${
                      checked
                        ? 'border-[rgb(var(--color-primary-400))] bg-primary-50 dark:bg-primary-500/20'
                        : 'border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))]'
                    }`}
                  />
                );
              })}
            </div>
          </div>
          <div className="grid items-end gap-4 lg:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_minmax(300px,2fr)]">
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-sm font-medium text-[rgb(var(--color-text-700))]">
                {t('credentials.audit.filter.actor')}
              </span>
              <UserPicker
                id="credentials-audit-actor-filter"
                users={users}
                value={actorUserId}
                onValueChange={setActorUserId}
                placeholder={t('credentials.audit.filter.allActors')}
                unassignedLabel={t('credentials.audit.filter.allActors')}
                labelStyle="none"
                buttonWidth="full"
                className="min-w-[180px]"
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-sm font-medium text-[rgb(var(--color-text-700))]">
                {t('credentials.audit.filter.client')}
              </span>
              <ClientPicker
                id="credentials-audit-client-filter"
                clients={clients}
                selectedClientId={clientId}
                onSelect={setClientId}
                placeholder={t('credentials.audit.filter.allClients')}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
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
        <CardHeader className="border-b border-[rgb(var(--color-border-200))] p-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            {t('credentials.audit.activityTitle', { defaultValue: 'Activity' })}
          </CardTitle>
        </CardHeader>
        <CardContent className="!p-0">
          {isLoading && !events ? (
            <p id="credentials-audit-loading" className="p-4 text-sm text-[rgb(var(--color-text-500))]">
              {t('credentials.audit.loading')}
            </p>
          ) : events && events.length === 0 ? (
            <p id="credentials-audit-empty" className="p-4 text-sm text-[rgb(var(--color-text-500))]">
              {activeFilters ? t('credentials.audit.emptyFiltered') : t('credentials.audit.empty')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-[rgb(var(--color-border-100))]">
                  <TableRow>
                    <TableHead className="text-sm font-semibold uppercase tracking-wide">{t('credentials.audit.col.when')}</TableHead>
                    <TableHead className="text-sm font-semibold uppercase tracking-wide">{t('credentials.audit.col.who')}</TableHead>
                    <TableHead className="text-sm font-semibold uppercase tracking-wide">{t('credentials.audit.col.action')}</TableHead>
                    <TableHead className="text-sm font-semibold uppercase tracking-wide">{t('credentials.audit.col.credential')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="[&_tr]:border-t [&_tr]:border-[rgb(var(--color-border-100))]">
                  {(events ?? []).map((event) => {
                    const when = new Date(event.timestamp);
                    const invalidDate = Number.isNaN(when.getTime());
                    const actorName = actorLabel(event.actor);
                    return (
                      <TableRow key={event.auditId}>
                        <TableCell className="whitespace-nowrap">
                          {invalidDate ? (
                            <span className="text-sm text-[rgb(var(--color-text-500))]">{event.timestamp}</span>
                          ) : (
                            <div>
                              <div className="text-base font-medium text-[rgb(var(--color-text-800))]">
                                {formatDate(when, { dateStyle: 'medium' })}
                              </div>
                              <div className="mt-0.5 text-sm text-[rgb(var(--color-text-600))]">
                                {formatDate(when, { timeStyle: 'short' })}
                              </div>
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <UserAvatar
                              userId={event.actor.userId ?? event.auditId}
                              userName={actorName}
                              avatarUrl={null}
                              size="sm"
                            />
                            <span className="text-base font-medium text-[rgb(var(--color-text-900))]">
                              {actorName}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={OPERATION_BADGE_VARIANTS[event.operation]} size="lg" className="font-medium">
                            {operationLabel(event.operation, event.entity?.type)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="text-base font-medium text-[rgb(var(--color-text-900))]">
                            {credentialCell(event.credentialId, event.credentialName)}
                          </div>
                          {event.clientName && (
                            <div className="mt-0.5 text-sm text-[rgb(var(--color-text-600))]">
                              {event.clientName}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {nextCursor !== null && (
            <div className="flex justify-center border-t border-[rgb(var(--color-border-200))] p-4">
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
