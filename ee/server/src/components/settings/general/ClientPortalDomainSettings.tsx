'use client';

import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import { AtSign } from 'lucide-react';
import { toast } from 'react-hot-toast';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

import {
  disablePortalDomainAction,
  getPortalDomainStatusAction,
  refreshPortalDomainStatusAction,
  requestPortalDomainRegistrationAction,
  retryPortalDomainRegistrationAction,
} from '@ee/lib/actions/tenant-actions/portalDomainActions';
import type { PortalDomainStatusResponse } from '@alga-psa/tenancy/actions/tenant-actions/portalDomain.types';
import type { PortalDomainStatus } from 'server/src/models/PortalDomainModel';

interface StatusBadgeConfig {
  label: string;
  variant: BadgeVariant;
}

const STATUS_BADGE_VARIANTS: Record<PortalDomainStatus, BadgeVariant> = {
  pending_dns: 'warning',
  verifying_dns: 'warning',
  dns_failed: 'error',
  pending_certificate: 'warning',
  certificate_issuing: 'warning',
  certificate_failed: 'error',
  deploying: 'secondary',
  active: 'success',
  disabled: 'default',
};

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function useStatusBadge() {
  const { t } = useTranslation('msp/settings');
  return (status: PortalDomainStatus | undefined): StatusBadgeConfig => {
    if (!status) {
      return { label: t('clientPortal.domain.badges.unknown'), variant: 'default' };
    }
    const variant = STATUS_BADGE_VARIANTS[status];
    if (!variant) {
      return { label: status.replace(/_/g, ' '), variant: 'default' };
    }
    return {
      label: t(`clientPortal.domain.badges.${status}` as const),
      variant,
    };
  };
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }
  }
  return fallback;
}

const ClientPortalDomainSettings = () => {
  const { t } = useTranslation('msp/settings');
  const getStatusBadge = useStatusBadge();
  const [portalStatus, setPortalStatus] = useState<PortalDomainStatusResponse | null>(null);
  const [portalLoading, setPortalLoading] = useState(true);
  const [domainInput, setDomainInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  const onEditDomainIntent = useCallback((_details: { previous: string; next: string }) => {
    // Placeholder – wired once edit workflow is implemented
  }, []);

  const syncPortalStatus = useCallback(async () => {
    setPortalLoading(true);
    try {
      const status = await getPortalDomainStatusAction();
      setPortalStatus(status);
      setDomainInput(status.domain ?? '');
      setPortalError(null);
    } catch (error) {
      const message = resolveErrorMessage(error, t('clientPortal.domain.messages.loadFailed'));
      setPortalError(message);
      console.error('Failed to load portal domain status:', error);
      toast.error(message);
    } finally {
      setPortalLoading(false);
    }
  }, [t]);

  useEffect(() => {
    syncPortalStatus();
  }, [syncPortalStatus]);

  const handleDomainSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!domainInput.trim()) {
      const message = t('clientPortal.domain.messages.enterDomainFirst');
      setPortalError(message);
      toast.error(message);
      return;
    }

    setSubmitting(true);
    try {
      const result = await requestPortalDomainRegistrationAction({ domain: domainInput.trim() });
      setPortalStatus(result.status);
      setDomainInput(result.status.domain ?? domainInput.trim());
      setPortalError(null);
      toast.success(t('clientPortal.domain.messages.requestSubmitted'));
    } catch (error: any) {
      const message = resolveErrorMessage(error, t('clientPortal.domain.messages.registerFailed'));
      setPortalError(message);
      console.error('Failed to register portal domain:', error);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const status = await refreshPortalDomainStatusAction();
      setPortalStatus(status);
      setDomainInput(status.domain ?? domainInput);
      setPortalError(null);
    } catch (error) {
      const message = resolveErrorMessage(error, t('clientPortal.domain.messages.refreshFailed'));
      setPortalError(message);
      console.error('Failed to refresh portal domain status:', error);
      toast.error(message);
    } finally {
      setRefreshing(false);
    }
  };

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const status = await retryPortalDomainRegistrationAction();
      setPortalStatus(status);
      setDomainInput(status.domain ?? domainInput);
      setPortalError(null);
      toast.success(t('clientPortal.domain.messages.retryQueued'));
    } catch (error: any) {
      const message = resolveErrorMessage(error, t('clientPortal.domain.messages.retryFailed'));
      setPortalError(message);
      console.error('Failed to retry custom domain provisioning:', error);
      toast.error(message);
    } finally {
      setRetrying(false);
    }
  };

  const handleDisable = async () => {
    if (!portalStatus?.domain) {
      return;
    }

    const confirmed = typeof window !== 'undefined'
      ? window.confirm(t('clientPortal.domain.messages.confirmRemove'))
      : true;

    if (!confirmed) {
      return;
    }

    setSubmitting(true);
    try {
      const status = await disablePortalDomainAction();
      setPortalStatus(status);
      setDomainInput(status.domain ?? '');
      setPortalError(null);
      toast.success(t('clientPortal.domain.messages.removalRequested'));
    } catch (error) {
      const message = resolveErrorMessage(error, t('clientPortal.domain.messages.disableFailed'));
      setPortalError(message);
      console.error('Failed to disable custom domain:', error);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const badge = getStatusBadge(portalStatus?.status);
  const existingDomain = portalStatus?.domain ?? null;
  const normalizedInput = domainInput.trim();
  const editingExistingDomain = Boolean(existingDomain);
  const isDirtyDomain = editingExistingDomain && normalizedInput !== existingDomain;

  const isFailureState = portalStatus?.status === 'dns_failed' || portalStatus?.status === 'certificate_failed';

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <AtSign className="h-5 w-5" />
            {t('clientPortal.domain.title')}
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
        </CardTitle>
        <CardDescription>
          {t('clientPortal.domain.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {portalError && (
          <Alert
            variant="destructive"
            className="mb-4"
            data-automation-id="client-portal-domain-error"
          >
            <AlertDescription>{portalError}</AlertDescription>
          </Alert>
        )}
        {portalLoading ? (
          <div className="space-y-3">
            <div className="h-5 w-48 animate-pulse rounded bg-gray-200" />
            <div className="h-24 animate-pulse rounded bg-gray-100" />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="rounded border border-gray-200 bg-gray-50 p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2">
                  <div className="text-sm font-medium text-gray-700">{t('clientPortal.domain.currentStatus')}</div>
                  <div className="text-sm text-gray-900">
                    {portalStatus?.domain ? (
                      <span className="font-semibold">{portalStatus.domain}</span>
                    ) : (
                      <span className="text-gray-500">{t('clientPortal.domain.noDomainConfigured')}</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600">
                    {portalStatus?.statusMessage || t('clientPortal.domain.defaultStatusMessage')}
                  </p>
                  <p className="text-xs text-gray-500">
                    {t('clientPortal.domain.lastChecked', { value: formatTimestamp(portalStatus?.lastCheckedAt) })}
                  </p>
                  {editingExistingDomain && (
                    <Alert variant="warning" showIcon={false} className="text-xs">
                      <AlertDescription>
                        {isDirtyDomain ? (
                          <span>
                            {t('clientPortal.domain.updatingDomainPrefix')}
                            <strong>{normalizedInput || '—'}</strong>
                            {t('clientPortal.domain.updatingDomainSuffix')}
                          </span>
                        ) : (
                          <span>
                            {t('clientPortal.domain.editInstructions')}
                          </span>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    id="client-portal-domain-refresh"
                    variant="outline"
                    size="sm"
                    onClick={handleRefresh}
                    disabled={submitting || refreshing || retrying}
                  >
                    {refreshing ? t('clientPortal.domain.actions.refreshing') : t('clientPortal.domain.actions.refresh')}
                  </Button>
                  {isFailureState && (
                    <Button
                      id="client-portal-domain-retry"
                      variant="outline"
                      size="sm"
                      onClick={handleRetry}
                      disabled={submitting || retrying}
                    >
                      {retrying ? t('clientPortal.domain.actions.retrying') : t('clientPortal.domain.actions.retry')}
                    </Button>
                  )}
                  {portalStatus?.domain && (
                    <Button
                      id="client-portal-domain-remove"
                      variant="ghost"
                      size="sm"
                      onClick={handleDisable}
                      disabled={submitting}
                    >
                      {t('clientPortal.domain.actions.removeDomain')}
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <form className="space-y-3" onSubmit={handleDomainSubmit}>
              <div>
                <label htmlFor="client-portal-domain-input" className="text-sm font-medium text-gray-700">
                  {t('clientPortal.domain.form.label')}
                </label>
                <p className="text-xs text-gray-500">
                  {t('clientPortal.domain.form.helpTextPrefix')}
                  <code className="rounded bg-gray-100 px-1 py-0.5">{portalStatus?.canonicalHost}</code>
                  {t('clientPortal.domain.form.helpTextSuffix')}
                </p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="client-portal-domain-input"
                    value={domainInput}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setDomainInput(nextValue);
                      if (editingExistingDomain && existingDomain && nextValue.trim() !== existingDomain) {
                        onEditDomainIntent({ previous: existingDomain, next: nextValue.trim() });
                      }
                    }}
                    placeholder={t('clientPortal.domain.form.placeholder')}
                    disabled={submitting}
                    autoComplete="off"
                  />
                    <Button
                      id="client-portal-domain-submit"
                      type="submit"
                      disabled={
                        submitting
                        || (!editingExistingDomain && !normalizedInput)
                        || (editingExistingDomain && !isDirtyDomain)
                      }
                    >
                      {submitting
                        ? t('clientPortal.domain.actions.submitting')
                      : editingExistingDomain
                        ? isDirtyDomain
                          ? t('clientPortal.domain.actions.updateDomain')
                          : t('clientPortal.domain.actions.saveDomain')
                        : t('clientPortal.domain.actions.saveDomain')}
                  </Button>
                  {editingExistingDomain && isDirtyDomain && (
                    <Button
                      id="client-portal-domain-cancel-edit"
                      type="button"
                      variant="ghost"
                      onClick={() => setDomainInput(existingDomain)}
                      disabled={submitting}
                    >
                      {t('clientPortal.domain.actions.cancelEdit')}
                    </Button>
                  )}
                </div>
              </div>
            </form>

            <div className="rounded border border-dashed border-gray-200 bg-white p-4 text-sm text-gray-600">
              <div className="font-medium text-gray-700">{t('clientPortal.domain.checklist.title')}</div>
              <ol className="mt-2 list-decimal space-y-2 pl-4">
                <li>
                  {t('clientPortal.domain.checklist.step1Prefix')}
                  <code className="rounded bg-gray-100 px-1 py-0.5">{portalStatus?.canonicalHost ?? t('clientPortal.domain.checklist.canonicalHostFallback')}</code>
                  {t('clientPortal.domain.checklist.step1Suffix')}
                </li>
                <li>{t('clientPortal.domain.checklist.step2')}</li>
                <li>
                  {t('clientPortal.domain.checklist.step3')}
                </li>
              </ol>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ClientPortalDomainSettings;
