'use client';

import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import { AtSign } from 'lucide-react';
import { toast } from 'react-hot-toast';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Badge, type BadgeVariant } from 'server/src/components/ui/Badge';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';

import {
  disablePortalDomainAction,
  getPortalDomainStatusAction,
  refreshPortalDomainStatusAction,
  requestPortalDomainRegistrationAction,
  retryPortalDomainRegistrationAction,
} from '@ee/lib/actions/tenant-actions/portalDomainActions';
import type { PortalDomainStatusResponse } from 'server/src/lib/actions/tenant-actions/portalDomain.types';
import type { PortalDomainStatus } from 'server/src/models/PortalDomainModel';

interface StatusBadgeConfig {
  label: string;
  variant: BadgeVariant;
}

const STATUS_BADGES: Record<PortalDomainStatus, StatusBadgeConfig> = {
  pending_dns: { label: 'Pending DNS', variant: 'warning' },
  verifying_dns: { label: 'Verifying DNS', variant: 'warning' },
  dns_failed: { label: 'DNS Failed', variant: 'error' },
  pending_certificate: { label: 'Pending Certificate', variant: 'warning' },
  certificate_issuing: { label: 'Issuing Certificate', variant: 'warning' },
  certificate_failed: { label: 'Certificate Failed', variant: 'error' },
  deploying: { label: 'Deploying', variant: 'secondary' },
  active: { label: 'Active', variant: 'success' },
  disabled: { label: 'Disabled', variant: 'default' },
};

const DEFAULT_STATUS_MESSAGE = 'No custom domain registered yet.';

function getStatusBadge(status: PortalDomainStatus | undefined): StatusBadgeConfig {
  if (!status) {
    return { label: 'Unknown', variant: 'default' };
  }

  return STATUS_BADGES[status] ?? { label: status.replace(/_/g, ' '), variant: 'default' };
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
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
      const message = resolveErrorMessage(error, 'Unable to load portal domain status.');
      setPortalError(message);
      console.error('Failed to load portal domain status:', error);
      toast.error(message);
    } finally {
      setPortalLoading(false);
    }
  }, []);

  useEffect(() => {
    syncPortalStatus();
  }, [syncPortalStatus]);

  const handleDomainSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!domainInput.trim()) {
      const message = 'Enter a domain before submitting.';
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
      toast.success('Custom domain request submitted.');
    } catch (error: any) {
      const message = resolveErrorMessage(error, 'Failed to register custom domain.');
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
      const message = resolveErrorMessage(error, 'Failed to refresh domain status.');
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
      toast.success('Retry queued. Re-check status in a few moments.');
    } catch (error: any) {
      const message = resolveErrorMessage(error, 'Retry failed.');
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
      ? window.confirm('Remove the current custom domain? Traffic will revert to the default hosted address.')
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
      toast.success('Custom domain removal requested.');
    } catch (error) {
      const message = resolveErrorMessage(error, 'Failed to disable custom domain.');
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
            Custom Domain
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
        </CardTitle>
        <CardDescription>
          Configure a branded hostname for your client portal. We will provision TLS certificates automatically once DNS is verified.
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
                  <div className="text-sm font-medium text-gray-700">Current status</div>
                  <div className="text-sm text-gray-900">
                    {portalStatus?.domain ? (
                      <span className="font-semibold">{portalStatus.domain}</span>
                    ) : (
                      <span className="text-gray-500">No custom domain configured</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600">
                    {portalStatus?.statusMessage || DEFAULT_STATUS_MESSAGE}
                  </p>
                  <p className="text-xs text-gray-500">
                    Last checked: {formatTimestamp(portalStatus?.lastCheckedAt)}
                  </p>
                  {editingExistingDomain && (
                    <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      {isDirtyDomain ? (
                        <span>
                          Updating domain to <strong>{normalizedInput || '—'}</strong>. Provisioning will restart once you update.
                        </span>
                      ) : (
                        <span>
                          To change your domain, edit the value below and submit to kick off a new provisioning run.
                        </span>
                      )}
                    </div>
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
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                  </Button>
                  {isFailureState && (
                    <Button
                      id="client-portal-domain-retry"
                      variant="outline"
                      size="sm"
                      onClick={handleRetry}
                      disabled={submitting || retrying}
                    >
                      {retrying ? 'Retrying…' : 'Retry'}
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
                      Remove Domain
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <form className="space-y-3" onSubmit={handleDomainSubmit}>
              <div>
                <label htmlFor="client-portal-domain-input" className="text-sm font-medium text-gray-700">
                  Custom domain
                </label>
                <p className="text-xs text-gray-500">
                  Add a CNAME record pointing to <code className="rounded bg-gray-100 px-1 py-0.5">{portalStatus?.canonicalHost}</code> before submitting.
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
                    placeholder="portal.example.com"
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
                        ? 'Submitting…'
                      : editingExistingDomain
                        ? isDirtyDomain
                          ? 'Update Domain'
                          : 'Save Domain'
                        : 'Save Domain'}
                  </Button>
                  {editingExistingDomain && isDirtyDomain && (
                    <Button
                      id="client-portal-domain-cancel-edit"
                      type="button"
                      variant="ghost"
                      onClick={() => setDomainInput(existingDomain)}
                      disabled={submitting}
                    >
                      Cancel Edit
                    </Button>
                  )}
                </div>
              </div>
            </form>

            <div className="rounded border border-dashed border-gray-200 bg-white p-4 text-sm text-gray-600">
              <div className="font-medium text-gray-700">Setup checklist</div>
              <ol className="mt-2 list-decimal space-y-2 pl-4">
                <li>
                  Create a CNAME record for your chosen host pointing to <code className="rounded bg-gray-100 px-1 py-0.5">{portalStatus?.canonicalHost ?? 'canonical host'}</code>.
                </li>
                <li>Click "Save Domain" to trigger DNS verification and certificate provisioning.</li>
                <li>
                  Use the Refresh button to poll provisioning progress. We will email your administrators if provisioning fails.
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
