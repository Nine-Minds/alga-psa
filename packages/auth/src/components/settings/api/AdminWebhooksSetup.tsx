'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Input } from '@alga-psa/ui/components/Input';
import {
  deleteWebhook,
  getWebhookStatsSnapshot,
  listWebhookDeliveries,
  listWebhookEvents,
  listWebhooks,
  retryWebhookDelivery,
  rotateWebhookSecret,
  sendWebhookTest,
  setWebhookActiveState,
  upsertWebhook,
  type WebhookDeliveryPage,
  type WebhookDeliveryView,
  type WebhookSettingsView,
} from '@alga-psa/auth/actions';

type WebhookFormState = {
  webhookId?: string;
  name: string;
  url: string;
  eventTypes: string[];
  customHeadersText: string;
  entityIdsText: string;
  retryConfigText: string;
  verifySsl: boolean;
  rateLimitPerMin: string;
  isActive: boolean;
};

type WebhookStatsSnapshot = {
  total: number;
  active: number;
  autoDisabled: number;
};

const DEFAULT_FORM: WebhookFormState = {
  name: '',
  url: '',
  eventTypes: [],
  customHeadersText: '',
  entityIdsText: '',
  retryConfigText: '',
  verifySsl: true,
  rateLimitPerMin: '100',
  isActive: true,
};

const DELIVERY_PAGE_SIZE = 10;

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'Never';
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function buildFormState(webhook: WebhookSettingsView): WebhookFormState {
  const customHeadersText = Object.entries(webhook.customHeaders)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
  const entityIdsText = webhook.entityIds.join('\n');
  const retryConfigText = webhook.retryConfig
    ? JSON.stringify(webhook.retryConfig, null, 2)
    : '';

  return {
    webhookId: webhook.webhookId,
    name: webhook.name,
    url: webhook.url,
    eventTypes: webhook.eventTypes,
    customHeadersText,
    entityIdsText,
    retryConfigText,
    verifySsl: webhook.verifySsl,
    rateLimitPerMin: String(webhook.rateLimitPerMin),
    isActive: webhook.isActive,
  };
}

function parseCustomHeaders(input: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of input.split('\n').map((value) => value.trim()).filter(Boolean)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) {
      throw new Error(`Invalid header line: "${line}"`);
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key || !value) {
      throw new Error(`Invalid header line: "${line}"`);
    }
    headers[key] = value;
  }

  return headers;
}

function parseEntityIds(input: string): string[] {
  return [...new Set(
    input
      .split(/[\n,\s]+/)
      .map((value) => value.trim())
      .filter(Boolean),
  )];
}

function parseRetryConfig(input: string): Record<string, unknown> | null {
  if (!input.trim()) {
    return null;
  }

  const parsed = JSON.parse(input) as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Retry config must be a JSON object');
  }

  return parsed as Record<string, unknown>;
}

function getHealthBadgeClasses(status: WebhookSettingsView['healthStatus']): string {
  if (status === 'healthy') {
    return 'bg-green-100 text-green-800';
  }
  if (status === 'failing') {
    return 'bg-amber-100 text-amber-800';
  }
  return 'bg-gray-200 text-gray-800';
}

function getDeliveryBadgeClasses(status: string): string {
  if (status === 'delivered') {
    return 'bg-green-100 text-green-800';
  }
  if (status === 'retrying') {
    return 'bg-amber-100 text-amber-800';
  }
  if (status === 'abandoned') {
    return 'bg-red-100 text-red-800';
  }
  return 'bg-gray-100 text-gray-800';
}

export default function AdminWebhooksSetup() {
  const [webhooks, setWebhooks] = useState<WebhookSettingsView[]>([]);
  const [eventOptions, setEventOptions] = useState<string[]>([]);
  const [stats, setStats] = useState<WebhookStatsSnapshot | null>(null);
  const [selectedWebhookId, setSelectedWebhookId] = useState<string | null>(null);
  const [formState, setFormState] = useState<WebhookFormState>(DEFAULT_FORM);
  const [deliveries, setDeliveries] = useState<WebhookDeliveryPage | null>(null);
  const [deliveryPage, setDeliveryPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  const selectedWebhook = useMemo(
    () => webhooks.find((webhook) => webhook.webhookId === selectedWebhookId) ?? null,
    [selectedWebhookId, webhooks],
  );

  const resetForm = useCallback(() => {
    setSelectedWebhookId(null);
    setFormState(DEFAULT_FORM);
    setDeliveries(null);
    setDeliveryPage(1);
    setRevealedSecret(null);
  }, []);

  const loadDeliveries = useCallback(async (webhookId: string, page: number = 1) => {
    const result = await listWebhookDeliveries(webhookId, page, DELIVERY_PAGE_SIZE);
    setDeliveries(result);
    setDeliveryPage(page);
  }, []);

  const loadData = useCallback(async (preferredWebhookId?: string | null) => {
    setLoading(true);
    try {
      const [nextWebhooks, nextEventOptions, nextStats] = await Promise.all([
        listWebhooks(),
        listWebhookEvents(),
        getWebhookStatsSnapshot(),
      ]);
      setWebhooks(nextWebhooks);
      setEventOptions(nextEventOptions);
      setStats(nextStats);

      const nextSelectedId = preferredWebhookId;
      const matchedWebhook = nextSelectedId
        ? nextWebhooks.find((webhook) => webhook.webhookId === nextSelectedId) ?? null
        : null;

      if (matchedWebhook) {
        setSelectedWebhookId(matchedWebhook.webhookId);
        setFormState(buildFormState(matchedWebhook));
        await loadDeliveries(matchedWebhook.webhookId, 1);
      } else if (nextWebhooks.length > 0 && preferredWebhookId !== null) {
        const fallbackWebhook = nextWebhooks[0];
        setSelectedWebhookId(fallbackWebhook.webhookId);
        setFormState(buildFormState(fallbackWebhook));
        await loadDeliveries(fallbackWebhook.webhookId, 1);
      } else if (!matchedWebhook && preferredWebhookId === null) {
        resetForm();
      }

      setError(null);
    } catch (loadError) {
      console.error('Failed to load webhook settings:', loadError);
      setError('Failed to load webhook settings.');
    } finally {
      setLoading(false);
    }
  }, [loadDeliveries, resetForm]);

  useEffect(() => {
    void loadData(null);
  }, [loadData]);

  const handleSelectWebhook = useCallback(async (webhook: WebhookSettingsView) => {
    setSelectedWebhookId(webhook.webhookId);
    setFormState(buildFormState(webhook));
    setRevealedSecret(null);
    setStatusMessage(null);
    try {
      await loadDeliveries(webhook.webhookId, 1);
      setError(null);
    } catch (loadError) {
      console.error('Failed to load webhook deliveries:', loadError);
      setError('Failed to load webhook deliveries.');
    }
  }, [loadDeliveries]);

  const handleFieldChange = useCallback(<K extends keyof WebhookFormState>(field: K, value: WebhookFormState[K]) => {
    setFormState((current) => ({ ...current, [field]: value }));
  }, []);

  const handleEventToggle = useCallback((eventType: string, checked: boolean) => {
    setFormState((current) => ({
      ...current,
      eventTypes: checked
        ? [...current.eventTypes, eventType]
        : current.eventTypes.filter((value) => value !== eventType),
    }));
  }, []);

  const handleSubmit = useCallback(async () => {
    try {
      setSaving(true);
      setStatusMessage(null);
      setRevealedSecret(null);

      const result = await upsertWebhook({
        webhookId: formState.webhookId,
        name: formState.name.trim(),
        url: formState.url.trim(),
        eventTypes: formState.eventTypes,
        customHeaders: parseCustomHeaders(formState.customHeadersText),
        entityIds: parseEntityIds(formState.entityIdsText),
        retryConfig: parseRetryConfig(formState.retryConfigText),
        verifySsl: formState.verifySsl,
        rateLimitPerMin: Number.parseInt(formState.rateLimitPerMin, 10),
        isActive: formState.isActive,
      });

      await loadData(result.webhook.webhookId);
      setFormState(buildFormState(result.webhook));
      setSelectedWebhookId(result.webhook.webhookId);
      setStatusMessage(formState.webhookId ? 'Webhook updated.' : 'Webhook created.');
      setRevealedSecret(result.signingSecret);
      setError(null);
    } catch (saveError) {
      console.error('Failed to save webhook:', saveError);
      setError(saveError instanceof Error ? saveError.message : 'Failed to save webhook.');
    } finally {
      setSaving(false);
    }
  }, [formState, loadData]);

  const handleDelete = useCallback(async () => {
    if (!selectedWebhook || !window.confirm(`Delete webhook "${selectedWebhook.name}"?`)) {
      return;
    }

    try {
      setSaving(true);
      await deleteWebhook(selectedWebhook.webhookId);
      await loadData(null);
      setStatusMessage('Webhook deleted.');
      setError(null);
    } catch (deleteError) {
      console.error('Failed to delete webhook:', deleteError);
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete webhook.');
    } finally {
      setSaving(false);
    }
  }, [loadData, selectedWebhook]);

  const handleSendTest = useCallback(async () => {
    if (!selectedWebhook) {
      return;
    }

    try {
      setTesting(true);
      const result = await sendWebhookTest(selectedWebhook.webhookId);
      await loadData(selectedWebhook.webhookId);
      setStatusMessage(
        result.success
          ? `Test sent successfully (${result.statusCode ?? 'n/a'}).`
          : `Test failed: ${result.errorMessage ?? 'Unknown error'}`,
      );
      setError(null);
    } catch (testError) {
      console.error('Failed to send webhook test:', testError);
      setError(testError instanceof Error ? testError.message : 'Failed to send webhook test.');
    } finally {
      setTesting(false);
    }
  }, [loadData, selectedWebhook]);

  const handleRotateSecret = useCallback(async () => {
    if (!selectedWebhook) {
      return;
    }

    try {
      setRotating(true);
      const result = await rotateWebhookSecret(selectedWebhook.webhookId);
      await loadData(selectedWebhook.webhookId);
      setRevealedSecret(result.signingSecret);
      setStatusMessage('Signing secret rotated.');
      setError(null);
    } catch (rotateError) {
      console.error('Failed to rotate webhook secret:', rotateError);
      setError(rotateError instanceof Error ? rotateError.message : 'Failed to rotate webhook secret.');
    } finally {
      setRotating(false);
    }
  }, [loadData, selectedWebhook]);

  const handleToggleActive = useCallback(async () => {
    if (!selectedWebhook) {
      return;
    }

    try {
      setSaving(true);
      const updated = await setWebhookActiveState(selectedWebhook.webhookId, !selectedWebhook.isActive);
      await loadData(updated.webhookId);
      setStatusMessage(updated.isActive ? 'Webhook resumed.' : 'Webhook paused.');
      setError(null);
    } catch (toggleError) {
      console.error('Failed to update webhook state:', toggleError);
      setError(toggleError instanceof Error ? toggleError.message : 'Failed to update webhook state.');
    } finally {
      setSaving(false);
    }
  }, [loadData, selectedWebhook]);

  const handleToggleActiveFor = useCallback(async (webhook: WebhookSettingsView) => {
    try {
      setSaving(true);
      const updated = await setWebhookActiveState(webhook.webhookId, !webhook.isActive);
      await loadData(updated.webhookId);
      setStatusMessage(updated.isActive ? 'Webhook resumed.' : 'Webhook paused.');
      setError(null);
    } catch (toggleError) {
      console.error('Failed to update webhook state:', toggleError);
      setError(toggleError instanceof Error ? toggleError.message : 'Failed to update webhook state.');
    } finally {
      setSaving(false);
    }
  }, [loadData]);

  const handleRetryDelivery = useCallback(async (delivery: WebhookDeliveryView) => {
    if (!selectedWebhook) {
      return;
    }

    try {
      await retryWebhookDelivery(selectedWebhook.webhookId, delivery.deliveryId);
      setStatusMessage(`Retry queued for event ${delivery.eventId}.`);
      setError(null);
    } catch (retryError) {
      console.error('Failed to retry delivery:', retryError);
      setError(retryError instanceof Error ? retryError.message : 'Failed to retry delivery.');
    }
  }, [selectedWebhook]);

  const totalPages = deliveries ? Math.max(1, Math.ceil(deliveries.total / deliveries.limit)) : 1;

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Outbound Webhooks</h2>
            <p className="mt-1 max-w-2xl text-sm text-gray-600">
              Create signed ticket lifecycle subscriptions, filter them to specific ticket IDs, inspect delivery history, and rotate secrets without leaving settings.
            </p>
          </div>
          <Button
            id="admin-webhooks-new"
            variant="ghost"
            onClick={resetForm}
          >
            New Webhook
          </Button>
        </div>

        {stats ? (
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="text-sm text-gray-500">Total webhooks</div>
              <div className="mt-2 text-2xl font-semibold">{stats.total}</div>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="text-sm text-gray-500">Active</div>
              <div className="mt-2 text-2xl font-semibold">{stats.active}</div>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="text-sm text-gray-500">Auto-disabled</div>
              <div className="mt-2 text-2xl font-semibold">{stats.autoDisabled}</div>
            </div>
          </div>
        ) : null}

        {revealedSecret ? (
          <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-sm font-medium text-emerald-900">Signing secret</div>
            <div className="mt-2 break-all rounded bg-white px-3 py-2 font-mono text-sm text-emerald-950">
              {revealedSecret}
            </div>
            <p className="mt-2 text-xs text-emerald-900">
              This value is shown only now. Store it in the receiver before you navigate away.
            </p>
          </div>
        ) : null}

        {statusMessage ? (
          <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            {statusMessage}
          </div>
        ) : null}

        {error ? (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            {error}
          </div>
        ) : null}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1.45fr)]">
        <Card className="p-6">
          <div className="mb-4">
            <h3 className="text-lg font-semibold">
              {formState.webhookId ? 'Edit Webhook' : 'Create Webhook'}
            </h3>
            <p className="mt-1 text-sm text-gray-600">
              Retry config is stored as JSON; delivery cadence still uses the platform’s standard backoff schedule in v1.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="webhook-name" className="mb-1 block text-sm font-medium text-gray-700">
                Name
              </label>
              <Input
                id="webhook-name"
                value={formState.name}
                onChange={(event) => handleFieldChange('name', event.target.value)}
                placeholder="Ticket assignment feed"
              />
            </div>

            <div>
              <label htmlFor="webhook-url" className="mb-1 block text-sm font-medium text-gray-700">
                URL
              </label>
              <Input
                id="webhook-url"
                value={formState.url}
                onChange={(event) => handleFieldChange('url', event.target.value)}
                placeholder="https://example.com/hooks/alga"
              />
            </div>

            <div>
              <div className="mb-2 text-sm font-medium text-gray-700">Events</div>
              <div className="grid gap-1 md:grid-cols-2">
                {eventOptions.map((eventType) => (
                  <Checkbox
                    key={eventType}
                    id={`webhook-event-${eventType}`}
                    label={eventType}
                    checked={formState.eventTypes.includes(eventType)}
                    onChange={(event) => handleEventToggle(eventType, event.target.checked)}
                    containerClassName="mb-0"
                  />
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="webhook-custom-headers" className="mb-1 block text-sm font-medium text-gray-700">
                Custom Headers
              </label>
              <textarea
                id="webhook-custom-headers"
                className="min-h-[96px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                value={formState.customHeadersText}
                onChange={(event) => handleFieldChange('customHeadersText', event.target.value)}
                placeholder={`Authorization: Bearer abc123\nX-Source: alga-psa`}
              />
            </div>

            <div>
              <label htmlFor="webhook-entity-ids" className="mb-1 block text-sm font-medium text-gray-700">
                Ticket Filter
              </label>
              <textarea
                id="webhook-entity-ids"
                className="min-h-[96px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                value={formState.entityIdsText}
                onChange={(event) => handleFieldChange('entityIdsText', event.target.value)}
                placeholder="One ticket UUID per line. Leave blank to receive all matching ticket events."
              />
            </div>

            <div>
              <label htmlFor="webhook-retry-config" className="mb-1 block text-sm font-medium text-gray-700">
                Retry Config JSON
              </label>
              <textarea
                id="webhook-retry-config"
                className="min-h-[96px] w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                value={formState.retryConfigText}
                onChange={(event) => handleFieldChange('retryConfigText', event.target.value)}
                placeholder={`{\n  "max_attempts": 5,\n  "timeout": 10000\n}`}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="webhook-rate-limit" className="mb-1 block text-sm font-medium text-gray-700">
                  Rate Limit / min
                </label>
                <Input
                  id="webhook-rate-limit"
                  type="number"
                  min={1}
                  max={1000}
                  value={formState.rateLimitPerMin}
                  onChange={(event) => handleFieldChange('rateLimitPerMin', event.target.value)}
                />
              </div>
              <div className="flex flex-col justify-end gap-2">
                <Checkbox
                  id="webhook-verify-ssl"
                  label="Verify SSL certificates"
                  checked={formState.verifySsl}
                  onChange={(event) => handleFieldChange('verifySsl', event.target.checked)}
                  containerClassName="mb-0"
                />
                <Checkbox
                  id="webhook-is-active"
                  label="Webhook is active"
                  checked={formState.isActive}
                  onChange={(event) => handleFieldChange('isActive', event.target.checked)}
                  containerClassName="mb-0"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                id="webhook-save"
                onClick={() => void handleSubmit()}
                disabled={saving}
              >
                {saving ? 'Saving…' : formState.webhookId ? 'Save Changes' : 'Create Webhook'}
              </Button>
              <Button
                id="webhook-cancel"
                variant="ghost"
                onClick={resetForm}
                disabled={saving}
              >
                Clear
              </Button>
              {selectedWebhook ? (
                <Button
                  id="webhook-delete"
                  variant="destructive"
                  onClick={() => void handleDelete()}
                  disabled={saving}
                >
                  Delete
                </Button>
              ) : null}
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Configured Webhooks</h3>
              <div className="text-sm text-gray-500">
                {loading ? 'Loading…' : `${webhooks.length} configured`}
              </div>
            </div>

            {webhooks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500">
                No webhooks configured yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead>
                    <tr className="text-left text-gray-500">
                      <th className="py-2 pr-4 font-medium">Name</th>
                      <th className="py-2 pr-4 font-medium">Status</th>
                      <th className="py-2 pr-4 font-medium">Last Delivery</th>
                      <th className="py-2 pr-4 font-medium">Success</th>
                      <th className="py-2 pr-4 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {webhooks.map((webhook) => (
                      <tr
                        key={webhook.webhookId}
                        className={selectedWebhookId === webhook.webhookId ? 'bg-primary-50/50' : ''}
                      >
                        <td className="py-3 pr-4 align-top">
                          <div className="font-medium text-gray-900">{webhook.name}</div>
                          <div className="mt-1 break-all text-xs text-gray-500">{webhook.url}</div>
                          <div className="mt-1 text-xs text-gray-500">{webhook.eventTypes.join(', ')}</div>
                        </td>
                        <td className="py-3 pr-4 align-top">
                          <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${getHealthBadgeClasses(webhook.healthStatus)}`}>
                            {webhook.healthStatus}
                          </span>
                        </td>
                        <td className="py-3 pr-4 align-top text-gray-700">
                          {formatDateTime(webhook.lastDeliveryAt)}
                        </td>
                        <td className="py-3 pr-4 align-top text-gray-700">
                          {formatPercent(webhook.successRate)}
                        </td>
                        <td className="py-3 pr-0 align-top">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              id={`select-webhook-${webhook.webhookId}`}
                              size="sm"
                              variant="ghost"
                              onClick={() => void handleSelectWebhook(webhook)}
                            >
                              {selectedWebhookId === webhook.webhookId ? 'Selected' : 'Manage'}
                            </Button>
                            <Button
                              id={`toggle-webhook-${webhook.webhookId}`}
                              size="sm"
                              variant="ghost"
                              onClick={() => void handleToggleActiveFor(webhook)}
                            >
                              {webhook.isActive ? 'Pause' : 'Resume'}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {selectedWebhook ? (
            <Card className="p-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="text-lg font-semibold">{selectedWebhook.name}</h3>
                  <p className="mt-1 break-all text-sm text-gray-600">{selectedWebhook.url}</p>
                  <p className="mt-2 text-sm text-gray-600">
                    {selectedWebhook.totalDeliveries} deliveries, {selectedWebhook.successfulDeliveries} successful, {selectedWebhook.failedDeliveries} failed.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    id="webhook-test"
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleSendTest()}
                    disabled={testing}
                  >
                    {testing ? 'Sending…' : 'Send Test'}
                  </Button>
                  <Button
                    id="webhook-rotate-secret"
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleRotateSecret()}
                    disabled={rotating}
                  >
                    {rotating ? 'Rotating…' : 'Rotate Secret'}
                  </Button>
                  <Button
                    id="webhook-pause-resume"
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleToggleActive()}
                    disabled={saving}
                  >
                    {selectedWebhook.isActive ? 'Pause' : 'Resume'}
                  </Button>
                </div>
              </div>

              <div className="mt-6">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                    Delivery History
                  </h4>
                  <div className="text-xs text-gray-500">
                    Page {deliveryPage} of {totalPages}
                  </div>
                </div>

                {!deliveries || deliveries.data.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500">
                    No deliveries recorded yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead>
                          <tr className="text-left text-gray-500">
                            <th className="py-2 pr-4 font-medium">Event</th>
                            <th className="py-2 pr-4 font-medium">Status</th>
                            <th className="py-2 pr-4 font-medium">Attempted</th>
                            <th className="py-2 pr-4 font-medium">Response</th>
                            <th className="py-2 pr-4 font-medium">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {deliveries.data.map((delivery) => (
                            <tr key={delivery.deliveryId}>
                              <td className="py-3 pr-4 align-top">
                                <div className="font-medium text-gray-900">{delivery.eventType}</div>
                                <div className="mt-1 break-all text-xs text-gray-500">{delivery.eventId}</div>
                                {delivery.isTest ? (
                                  <div className="mt-1 text-xs text-blue-600">Test delivery</div>
                                ) : null}
                              </td>
                              <td className="py-3 pr-4 align-top">
                                <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${getDeliveryBadgeClasses(delivery.status)}`}>
                                  {delivery.status}
                                </span>
                                <div className="mt-1 text-xs text-gray-500">
                                  Attempt {delivery.attemptNumber}
                                </div>
                              </td>
                              <td className="py-3 pr-4 align-top text-gray-700">
                                {formatDateTime(delivery.attemptedAt)}
                              </td>
                              <td className="py-3 pr-4 align-top">
                                <div className="text-gray-700">
                                  {delivery.responseStatusCode ?? 'n/a'}
                                  {delivery.durationMs !== null ? ` • ${delivery.durationMs} ms` : ''}
                                </div>
                                <div className="mt-1 max-w-md whitespace-pre-wrap break-words text-xs text-gray-500">
                                  {delivery.errorMessage ?? delivery.responseBody ?? 'No response body captured.'}
                                </div>
                              </td>
                              <td className="py-3 pr-0 align-top">
                                {!delivery.isTest ? (
                                  <Button
                                    id={`retry-delivery-${delivery.deliveryId}`}
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => void handleRetryDelivery(delivery)}
                                  >
                                    Retry
                                  </Button>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex items-center justify-between">
                      <Button
                        id="webhook-deliveries-prev"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (selectedWebhook && deliveryPage > 1) {
                            void loadDeliveries(selectedWebhook.webhookId, deliveryPage - 1);
                          }
                        }}
                        disabled={deliveryPage <= 1}
                      >
                        Previous
                      </Button>
                      <Button
                        id="webhook-deliveries-next"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (selectedWebhook && deliveryPage < totalPages) {
                            void loadDeliveries(selectedWebhook.webhookId, deliveryPage + 1);
                          }
                        }}
                        disabled={deliveryPage >= totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
