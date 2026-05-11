'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from '@alga-psa/ui/components/Dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { ArrowLeft, MoreVertical } from 'lucide-react';
import type { ColumnDefinition } from '@alga-psa/types';
import { buildTenantPortalSlug } from '@alga-psa/validation';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
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
} from '@/lib/actions/webhookActions';
import {
  captureSamplePayload,
  listInboundWebhookActions,
  listInboundDeliveries,
  listInboundWebhooks,
  type InboundActionDefinitionView,
} from '@/lib/actions/inboundWebhookActions';
import { WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY } from '@/lib/actions/webhookPayloadFields';
import type {
  InboundWebhookConfig,
  InboundWebhookDelivery,
} from '@/lib/inboundWebhooks/types';
import { InboundWebhookMappingField } from './inbound/InboundWebhookMappingField';

// Entities live in a static registry; this turns the readonly field arrays
// into mutable string[] for the UI render layer.
const PAYLOAD_FIELD_ENTITIES = Object.keys(WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY) as
  Array<keyof typeof WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY>;

function entityForEventType(eventType: string): string {
  const dot = eventType.indexOf('.');
  return dot > 0 ? eventType.slice(0, dot) : eventType;
}

function fieldsForEntity(entity: string): string[] {
  const list = (WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY as Record<string, readonly string[]>)[entity];
  return list ? [...list] : [];
}

type WebhookFormState = {
  webhookId?: string;
  name: string;
  url: string;
  eventTypes: string[];
  customHeadersText: string;
  entityIdsText: string;
  retryConfigText: string;
  verifySsl: boolean;
  /**
   * Per-entity payload field selection. Stored as an explicit selected set
   * for every registered entity (default: every field selected). On save,
   * if every entity's selection is exhaustive, we send `null` (full payload
   * sentinel); otherwise we send the explicit allowlist map.
   */
  payloadFieldSelection: Record<string, string[]>;
  isActive: boolean;
};

type InboundWebhookIdentityFormState = {
  inboundWebhookId?: string;
  name: string;
  slug: string;
  description: string;
  authType: InboundWebhookConfig['authType'];
  hmacSignatureHeader: string;
  bearerToken: string;
  ipCidrs: string;
  pathTokenQueryParam: string;
  pathToken: string;
  idempotencyType: 'header' | 'jsonata';
  idempotencyValue: string;
  idempotencyWindowSeconds: number;
  handlerType: InboundWebhookConfig['handlerType'];
  directActionName: string;
  workflowId: string;
  fieldMapping: Record<string, string>;
  samplePayload: unknown | null;
  sampleCaptureExpiresAt: string | Date | null;
};

type WebhookStatsSnapshot = {
  total: number;
  active: number;
  autoDisabled: number;
};

function defaultPayloadFieldSelection(): Record<string, string[]> {
  const selection: Record<string, string[]> = {};
  for (const entity of PAYLOAD_FIELD_ENTITIES) {
    selection[entity] = fieldsForEntity(entity);
  }
  return selection;
}

const DEFAULT_FORM: WebhookFormState = {
  name: '',
  url: '',
  eventTypes: [],
  customHeadersText: '',
  entityIdsText: '',
  retryConfigText: '',
  verifySsl: true,
  payloadFieldSelection: defaultPayloadFieldSelection(),
  isActive: true,
};

const DELIVERY_PAGE_SIZE = 10;

function formatDateTime(value: string | null, neverLabel: string): string {
  return value ? new Date(value).toLocaleString() : neverLabel;
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

  // Reconstitute the per-entity selection from the saved value:
  //   null  -> default-select-all for every entity (the "saved as full payload" case)
  //   map   -> entries override the all-selected default; missing entities stay all-selected
  //   list  -> if `payloadFields[entity]` is null, treat that entity as full-payload again
  const baseline = defaultPayloadFieldSelection();
  if (webhook.payloadFields) {
    for (const [entity, fields] of Object.entries(webhook.payloadFields)) {
      if (fields === null) continue; // explicit "full payload" for this entity
      baseline[entity] = [...fields];
    }
  }

  return {
    webhookId: webhook.webhookId,
    name: webhook.name,
    url: webhook.url,
    eventTypes: webhook.eventTypes,
    customHeadersText,
    entityIdsText,
    retryConfigText,
    verifySsl: webhook.verifySsl,
    payloadFieldSelection: baseline,
    isActive: webhook.isActive,
  };
}

/**
 * Convert the form's per-entity selection to the API shape.
 *   - If every selection still matches the registry exhaustively → null
 *     (server stores "full payload" sentinel)
 *   - Otherwise → explicit allowlist map for entities that diverge
 */
function buildPayloadFieldsForSave(
  selection: Record<string, string[]>,
): Record<string, string[] | null> | null {
  const overrides: Record<string, string[]> = {};
  let anyOverride = false;
  for (const entity of PAYLOAD_FIELD_ENTITIES) {
    const all = fieldsForEntity(entity);
    const selected = selection[entity] ?? all;
    if (selected.length === all.length && selected.every((f) => all.includes(f))) {
      continue; // exhaustive — fall back to "full payload" for this entity
    }
    overrides[entity] = selected;
    anyOverride = true;
  }
  return anyOverride ? overrides : null;
}

function parseCustomHeaders(
  input: string,
  invalidLineMessage: (line: string) => string,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of input.split('\n').map((value) => value.trim()).filter(Boolean)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) {
      throw new Error(invalidLineMessage(line));
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key || !value) {
      throw new Error(invalidLineMessage(line));
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

function parseRetryConfig(input: string, invalidShapeMessage: string): Record<string, unknown> | null {
  if (!input.trim()) {
    return null;
  }

  const parsed = JSON.parse(input) as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(invalidShapeMessage);
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
  const { t } = useTranslation('msp/profile');
  const [activeTab, setActiveTab] = useState<'inbound' | 'outbound'>('inbound');

  return (
    <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'inbound' | 'outbound')}>
      <TabsList className="mb-6">
        <TabsTrigger id="webhooks-inbound-tab" value="inbound">
          {t('security.webhooks.tabs.inbound')}
        </TabsTrigger>
        <TabsTrigger id="webhooks-outbound-tab" value="outbound">
          {t('security.webhooks.tabs.outbound')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="inbound">
        <InboundWebhooksListView />
      </TabsContent>
      <TabsContent value="outbound">
        <OutboundWebhooksSetup />
      </TabsContent>
    </Tabs>
  );
}

function buildInboundWebhookUrl(webhook: InboundWebhookConfig): string {
  const tenantSlug = buildTenantPortalSlug(webhook.tenant);
  return `/api/inbound/${tenantSlug}/${webhook.slug}`;
}

function slugifyInboundWebhookName(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function formatInboundHandlerLabel(
  webhook: InboundWebhookConfig,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (webhook.handlerType === 'direct_action') {
    return t('security.webhooks.inbound.handlers.directAction');
  }

  return t('security.webhooks.inbound.handlers.workflow');
}

function InboundWebhooksListView() {
  const { t } = useTranslation('msp/profile');
  const [webhooks, setWebhooks] = useState<InboundWebhookConfig[]>([]);
  const [inboundActions, setInboundActions] = useState<InboundActionDefinitionView[]>([]);
  const [lastDeliveries, setLastDeliveries] = useState<Record<string, InboundWebhookDelivery | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tableCurrentPage, setTableCurrentPage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(10);
  const [identityDialogOpen, setIdentityDialogOpen] = useState(false);
  const [identityForm, setIdentityForm] = useState<InboundWebhookIdentityFormState>({
    name: '',
    slug: '',
    description: '',
    authType: 'hmac_sha256',
    hmacSignatureHeader: 'X-Alga-Signature',
    bearerToken: '',
    ipCidrs: '',
    pathTokenQueryParam: 'token',
    pathToken: '',
    idempotencyType: 'header',
    idempotencyValue: 'X-Idempotency-Key',
    idempotencyWindowSeconds: 86400,
    handlerType: 'direct_action',
    directActionName: '',
    workflowId: '',
    fieldMapping: {},
    samplePayload: null,
    sampleCaptureExpiresAt: null,
  });
  const [revealedInboundSecret, setRevealedInboundSecret] = useState<{
    webhookName: string;
    secret: string;
  } | null>(null);
  const neverLabel = t('security.webhooks.common.never');

  const loadInboundWebhooks = useCallback(async () => {
    try {
      setLoading(true);
      const [configs, actionDefinitions] = await Promise.all([
        listInboundWebhooks(),
        listInboundWebhookActions(),
      ]);
      setWebhooks(configs);
      setInboundActions(actionDefinitions);
      setError(null);

      const deliveryEntries = await Promise.all(
        configs.map(async (webhook) => {
          const page = await listInboundDeliveries(
            { inboundWebhookId: webhook.inboundWebhookId },
            1,
            1,
          );
          return [webhook.inboundWebhookId, page.data[0] ?? null] as const;
        }),
      );
      setLastDeliveries(Object.fromEntries(deliveryEntries));
    } catch (loadError) {
      console.error('Failed to load inbound webhooks:', loadError);
      setError(loadError instanceof Error ? loadError.message : t('security.webhooks.inbound.messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadInboundWebhooks();
  }, [loadInboundWebhooks]);

  const columns = useMemo<ColumnDefinition<InboundWebhookConfig>[]>(() => [
    {
      title: t('security.webhooks.inbound.list.columns.name'),
      dataIndex: 'name',
      render: (_value, webhook) => (
        <div>
          <div className="font-medium text-gray-900">{webhook.name}</div>
          <div className="mt-1 break-all text-xs text-gray-500">{buildInboundWebhookUrl(webhook)}</div>
          {webhook.description ? (
            <div className="mt-1 text-xs text-gray-500">{webhook.description}</div>
          ) : null}
        </div>
      ),
    },
    {
      title: t('security.webhooks.inbound.list.columns.handler'),
      dataIndex: 'handlerType',
      render: (_value, webhook) => (
        <div>
          <div className="text-sm text-gray-900">{formatInboundHandlerLabel(webhook, t)}</div>
          {webhook.handlerConfig.type === 'direct_action' ? (
            <div className="mt-1 text-xs text-gray-500">{webhook.handlerConfig.action}</div>
          ) : null}
        </div>
      ),
    },
    {
      title: t('security.webhooks.inbound.list.columns.lastDelivery'),
      dataIndex: 'updatedAt',
      render: (_value, webhook) => formatDateTime(
        (lastDeliveries[webhook.inboundWebhookId]?.receivedAt as string | undefined) ?? null,
        neverLabel,
      ),
    },
    {
      title: t('security.webhooks.inbound.list.columns.active'),
      dataIndex: 'isActive',
      render: (_value, webhook) => (
        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
          webhook.isActive
            ? 'bg-green-50 text-green-700 ring-1 ring-green-600/20'
            : 'bg-gray-100 text-gray-700 ring-1 ring-gray-500/20'
        }`}>
          {webhook.isActive
            ? t('security.webhooks.inbound.status.active')
            : t('security.webhooks.inbound.status.inactive')}
        </span>
      ),
    },
    {
      title: t('security.webhooks.inbound.list.columns.actions'),
      dataIndex: 'inboundWebhookId',
      sortable: false,
      width: '64px',
      render: (_value, webhook) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={`inbound-webhook-actions-${webhook.inboundWebhookId}`}
              variant="ghost"
              className="h-8 w-8 p-0"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem id={`inbound-webhook-view-${webhook.inboundWebhookId}`} disabled>
              {t('security.webhooks.list.actions.view')}
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`inbound-webhook-edit-${webhook.inboundWebhookId}`}
              onClick={() => {
                setIdentityForm({
                  inboundWebhookId: webhook.inboundWebhookId,
                  name: webhook.name,
                  slug: webhook.slug,
                  description: webhook.description ?? '',
                  authType: webhook.authType,
                  hmacSignatureHeader: webhook.authConfig.type === 'hmac_sha256'
                    ? webhook.authConfig.signatureHeader
                    : 'X-Alga-Signature',
                  bearerToken: '',
                  ipCidrs: webhook.authConfig.type === 'ip_allowlist'
                    ? webhook.authConfig.ipCidrs.join('\n')
                    : '',
                  pathTokenQueryParam: webhook.authConfig.type === 'path_token'
                    ? webhook.authConfig.queryParam
                    : 'token',
                  pathToken: '',
                  idempotencyType: webhook.idempotencySource?.type ?? 'header',
                  idempotencyValue: webhook.idempotencySource?.value ?? 'X-Idempotency-Key',
                  idempotencyWindowSeconds: webhook.idempotencyWindowSeconds,
                  handlerType: webhook.handlerType,
                  directActionName: webhook.handlerConfig.type === 'direct_action'
                    ? webhook.handlerConfig.action
                    : '',
                  workflowId: webhook.handlerConfig.type === 'workflow'
                    ? webhook.handlerConfig.workflowId
                    : '',
                  fieldMapping: webhook.handlerConfig.type === 'direct_action'
                    ? webhook.handlerConfig.fieldMapping
                    : {},
                  samplePayload: webhook.samplePayload,
                  sampleCaptureExpiresAt: webhook.sampleCaptureExpiresAt,
                });
                setIdentityDialogOpen(true);
              }}
            >
              {t('security.webhooks.list.actions.edit')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ], [lastDeliveries, neverLabel, t]);

  const handleTablePageSizeChange = useCallback((newPageSize: number) => {
    setTablePageSize(newPageSize);
    setTableCurrentPage(1);
  }, []);

  const handleNewInboundWebhook = useCallback(() => {
    setIdentityForm({
      name: '',
      slug: '',
      description: '',
      authType: 'hmac_sha256',
      hmacSignatureHeader: 'X-Alga-Signature',
      bearerToken: '',
      ipCidrs: '',
      pathTokenQueryParam: 'token',
      pathToken: '',
      idempotencyType: 'header',
      idempotencyValue: 'X-Idempotency-Key',
      idempotencyWindowSeconds: 86400,
      handlerType: 'direct_action',
      directActionName: '',
      workflowId: '',
      fieldMapping: {},
      samplePayload: null,
      sampleCaptureExpiresAt: null,
    });
    setIdentityDialogOpen(true);
  }, []);

  const authTypeOptions = useMemo(() => [
    { value: 'hmac_sha256', label: t('security.webhooks.inbound.auth.types.hmacSha256') },
    { value: 'bearer', label: t('security.webhooks.inbound.auth.types.bearer') },
    { value: 'ip_allowlist', label: t('security.webhooks.inbound.auth.types.ipAllowlist') },
    { value: 'path_token', label: t('security.webhooks.inbound.auth.types.pathToken') },
  ], [t]);

  const idempotencySourceOptions = useMemo(() => [
    { value: 'header', label: t('security.webhooks.inbound.idempotency.types.header') },
    { value: 'jsonata', label: t('security.webhooks.inbound.idempotency.types.jsonata') },
  ], [t]);

  const handlerTypeOptions = useMemo(() => [
    { value: 'direct_action', label: t('security.webhooks.inbound.handler.types.directAction') },
    { value: 'workflow', label: t('security.webhooks.inbound.handler.types.workflow') },
  ], [t]);

  const inboundActionOptions = useMemo(() => inboundActions.map((action) => ({
    value: action.name,
    label: `${action.entityType}: ${action.displayName}`,
  })), [inboundActions]);

  const selectedInboundAction = useMemo(
    () => inboundActions.find((action) => action.name === identityForm.directActionName) ?? null,
    [identityForm.directActionName, inboundActions],
  );

  const sampleCaptureActive = identityForm.sampleCaptureExpiresAt
    ? new Date(identityForm.sampleCaptureExpiresAt).getTime() > Date.now()
    : false;

  const handleCaptureSample = useCallback(async () => {
    if (!identityForm.inboundWebhookId) {
      return;
    }

    try {
      const updated = await captureSamplePayload(identityForm.inboundWebhookId);
      setIdentityForm((current) => ({
        ...current,
        sampleCaptureExpiresAt: updated.sampleCaptureExpiresAt,
        samplePayload: updated.samplePayload,
      }));
      setWebhooks((current) => current.map((webhook) => (
        webhook.inboundWebhookId === updated.inboundWebhookId ? updated : webhook
      )));
      setError(null);
    } catch (captureError) {
      console.error('Failed to enable inbound webhook sample capture:', captureError);
      setError(captureError instanceof Error ? captureError.message : t('security.webhooks.inbound.sample.captureFailed'));
    }
  }, [identityForm.inboundWebhookId, t]);

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">{t('security.webhooks.inbound.title')}</h2>
            <p className="mt-1 max-w-2xl text-sm text-gray-600">
              {t('security.webhooks.inbound.description')}
            </p>
          </div>
          <Button
            id="inbound-webhooks-new"
            onClick={handleNewInboundWebhook}
          >
            {t('security.webhooks.inbound.newWebhook')}
          </Button>
        </div>

        {error ? (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            {error}
          </div>
        ) : null}
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{t('security.webhooks.inbound.list.title')}</h3>
          <div className="text-sm text-gray-500">
            {loading
              ? t('security.webhooks.inbound.list.loading')
              : t('security.webhooks.inbound.list.configuredCount', { count: webhooks.length })}
          </div>
        </div>

        {webhooks.length === 0 && !loading ? (
          <div className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500">
            {t('security.webhooks.inbound.list.empty')}
          </div>
        ) : (
          <DataTable<InboundWebhookConfig>
            id="inbound-webhooks-table"
            data={webhooks}
            columns={columns}
            pagination
            currentPage={tableCurrentPage}
            onPageChange={setTableCurrentPage}
            pageSize={tablePageSize}
            onItemsPerPageChange={handleTablePageSizeChange}
          />
        )}
      </Card>

      <Dialog
        id="inbound-webhook-secret"
        isOpen={revealedInboundSecret !== null}
        onClose={() => setRevealedInboundSecret(null)}
        title={t('security.webhooks.inbound.secret.label')}
      >
        <DialogContent>
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              {t('security.webhooks.inbound.secret.warning')}
            </p>
            <div className="rounded-md bg-gray-50 p-4">
              <code className="break-all text-sm">{revealedInboundSecret?.secret ?? ''}</code>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                id="inbound-webhook-secret-copy"
                className="w-full"
                onClick={async () => {
                  if (!revealedInboundSecret?.secret) return;
                  try {
                    await navigator.clipboard.writeText(revealedInboundSecret.secret);
                  } catch (copyError) {
                    console.error('Failed to copy inbound webhook secret:', copyError);
                  }
                }}
              >
                {t('security.webhooks.inbound.secret.copy')}
              </Button>
              <Button
                id="inbound-webhook-secret-download"
                variant="outline"
                className="w-full"
                onClick={() => {
                  if (!revealedInboundSecret?.secret) return;
                  const safeName = (revealedInboundSecret.webhookName || 'inbound-webhook')
                    .toLowerCase()
                    .replace(/[^a-z0-9-_]+/g, '-')
                    .replace(/^-+|-+$/g, '')
                    || 'inbound-webhook';
                  const blob = new Blob([revealedInboundSecret.secret], { type: 'text/plain' });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `${safeName}-secret.txt`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  URL.revokeObjectURL(url);
                }}
              >
                {t('security.webhooks.inbound.secret.download')}
              </Button>
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button
            id="inbound-webhook-secret-close"
            variant="ghost"
            onClick={() => setRevealedInboundSecret(null)}
          >
            {t('security.webhooks.inbound.secret.close')}
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        id="inbound-webhook-identity"
        isOpen={identityDialogOpen}
        onClose={() => setIdentityDialogOpen(false)}
        title={
          identityForm.inboundWebhookId
            ? t('security.webhooks.inbound.dialog.editTitle')
            : t('security.webhooks.inbound.dialog.createTitle')
        }
      >
        <DialogContent>
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                {t('security.webhooks.inbound.identity.title')}
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                {t('security.webhooks.inbound.identity.help')}
              </p>
            </div>
            <Input
              id="inbound-webhook-name"
              label={t('security.webhooks.inbound.identity.name')}
              value={identityForm.name}
              required
              placeholder={t('security.webhooks.inbound.identity.namePlaceholder')}
              onChange={(event) => {
                const nextName = event.target.value;
                setIdentityForm((current) => ({
                  ...current,
                  name: nextName,
                  slug: current.slug ? current.slug : slugifyInboundWebhookName(nextName),
                }));
              }}
            />
            <Input
              id="inbound-webhook-slug"
              label={t('security.webhooks.inbound.identity.slug')}
              value={identityForm.slug}
              required
              placeholder={t('security.webhooks.inbound.identity.slugPlaceholder')}
              onChange={(event) => {
                setIdentityForm((current) => ({
                  ...current,
                  slug: slugifyInboundWebhookName(event.target.value),
                }));
              }}
            />
            <TextArea
              id="inbound-webhook-description"
              label={t('security.webhooks.inbound.identity.description')}
              value={identityForm.description}
              placeholder={t('security.webhooks.inbound.identity.descriptionPlaceholder')}
              onChange={(event) => {
                setIdentityForm((current) => ({
                  ...current,
                  description: event.target.value,
                }));
              }}
            />
            <div className="border-t border-gray-200 pt-4">
              <h3 className="text-sm font-semibold text-gray-900">
                {t('security.webhooks.inbound.auth.title')}
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                {t('security.webhooks.inbound.auth.help')}
              </p>
            </div>
            <CustomSelect
              id="inbound-webhook-auth-type"
              label={t('security.webhooks.inbound.auth.method')}
              value={identityForm.authType}
              onValueChange={(value) => {
                setIdentityForm((current) => ({
                  ...current,
                  authType: value as InboundWebhookConfig['authType'],
                }));
              }}
              options={authTypeOptions}
            />
            {identityForm.authType === 'hmac_sha256' ? (
              <Input
                id="inbound-webhook-auth-hmac-header"
                label={t('security.webhooks.inbound.auth.signatureHeader')}
                value={identityForm.hmacSignatureHeader}
                required
                placeholder={t('security.webhooks.inbound.auth.signatureHeaderPlaceholder')}
                onChange={(event) => {
                  setIdentityForm((current) => ({
                    ...current,
                    hmacSignatureHeader: event.target.value,
                  }));
                }}
              />
            ) : null}
            {identityForm.authType === 'bearer' ? (
              <Input
                id="inbound-webhook-auth-bearer-token"
                label={t('security.webhooks.inbound.auth.bearerToken')}
                value={identityForm.bearerToken}
                type="password"
                placeholder={identityForm.inboundWebhookId
                  ? t('security.webhooks.inbound.auth.secretUnchangedPlaceholder')
                  : t('security.webhooks.inbound.auth.bearerTokenPlaceholder')}
                onChange={(event) => {
                  setIdentityForm((current) => ({
                    ...current,
                    bearerToken: event.target.value,
                  }));
                }}
              />
            ) : null}
            {identityForm.authType === 'ip_allowlist' ? (
              <TextArea
                id="inbound-webhook-auth-ip-cidrs"
                label={t('security.webhooks.inbound.auth.ipCidrs')}
                value={identityForm.ipCidrs}
                required
                placeholder={t('security.webhooks.inbound.auth.ipCidrsPlaceholder')}
                onChange={(event) => {
                  setIdentityForm((current) => ({
                    ...current,
                    ipCidrs: event.target.value,
                  }));
                }}
              />
            ) : null}
            {identityForm.authType === 'path_token' ? (
              <div className="grid gap-4 md:grid-cols-2">
                <Input
                  id="inbound-webhook-auth-path-token-param"
                  label={t('security.webhooks.inbound.auth.queryParam')}
                  value={identityForm.pathTokenQueryParam}
                  required
                  placeholder={t('security.webhooks.inbound.auth.queryParamPlaceholder')}
                  onChange={(event) => {
                    setIdentityForm((current) => ({
                      ...current,
                      pathTokenQueryParam: event.target.value,
                    }));
                  }}
                />
                <Input
                  id="inbound-webhook-auth-path-token"
                  label={t('security.webhooks.inbound.auth.pathToken')}
                  value={identityForm.pathToken}
                  type="password"
                  placeholder={identityForm.inboundWebhookId
                    ? t('security.webhooks.inbound.auth.secretUnchangedPlaceholder')
                    : t('security.webhooks.inbound.auth.pathTokenPlaceholder')}
                  onChange={(event) => {
                    setIdentityForm((current) => ({
                      ...current,
                      pathToken: event.target.value,
                    }));
                  }}
                />
              </div>
            ) : null}
            <div className="border-t border-gray-200 pt-4">
              <h3 className="text-sm font-semibold text-gray-900">
                {t('security.webhooks.inbound.idempotency.title')}
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                {t('security.webhooks.inbound.idempotency.help')}
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <CustomSelect
                id="inbound-webhook-idempotency-type"
                label={t('security.webhooks.inbound.idempotency.source')}
                value={identityForm.idempotencyType}
                onValueChange={(value) => {
                  setIdentityForm((current) => ({
                    ...current,
                    idempotencyType: value as 'header' | 'jsonata',
                    idempotencyValue: value === 'header' ? 'X-Idempotency-Key' : 'id',
                  }));
                }}
                options={idempotencySourceOptions}
              />
              <Input
                id="inbound-webhook-idempotency-value"
                label={identityForm.idempotencyType === 'header'
                  ? t('security.webhooks.inbound.idempotency.headerName')
                  : t('security.webhooks.inbound.idempotency.jsonataExpression')}
                value={identityForm.idempotencyValue}
                placeholder={identityForm.idempotencyType === 'header'
                  ? t('security.webhooks.inbound.idempotency.headerNamePlaceholder')
                  : t('security.webhooks.inbound.idempotency.jsonataExpressionPlaceholder')}
                onChange={(event) => {
                  setIdentityForm((current) => ({
                    ...current,
                    idempotencyValue: event.target.value,
                  }));
                }}
              />
            </div>
            <Input
              id="inbound-webhook-idempotency-window"
              label={t('security.webhooks.inbound.idempotency.windowSeconds')}
              type="number"
              min={60}
              value={identityForm.idempotencyWindowSeconds}
              onChange={(event) => {
                setIdentityForm((current) => ({
                  ...current,
                  idempotencyWindowSeconds: Number(event.target.value) || 86400,
                }));
              }}
            />
            <div className="border-t border-gray-200 pt-4">
              <h3 className="text-sm font-semibold text-gray-900">
                {t('security.webhooks.inbound.handler.title')}
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                {t('security.webhooks.inbound.handler.help')}
              </p>
            </div>
            <CustomSelect
              id="inbound-webhook-handler-type"
              label={t('security.webhooks.inbound.handler.type')}
              value={identityForm.handlerType}
              onValueChange={(value) => {
                setIdentityForm((current) => ({
                  ...current,
                  handlerType: value as InboundWebhookConfig['handlerType'],
                }));
              }}
              options={handlerTypeOptions}
            />
            <div className="rounded-md border border-gray-200 bg-white p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h4 className="text-sm font-medium text-gray-900">
                    {t('security.webhooks.inbound.sample.title')}
                  </h4>
                  <p className="mt-1 text-sm text-gray-500">
                    {identityForm.inboundWebhookId
                      ? t('security.webhooks.inbound.sample.help')
                      : t('security.webhooks.inbound.sample.createFirst')}
                  </p>
                  <div className="mt-2 text-xs text-gray-500">
                    {sampleCaptureActive
                      ? t('security.webhooks.inbound.sample.captureActive', {
                        expiresAt: formatDateTime(identityForm.sampleCaptureExpiresAt as string, neverLabel),
                      })
                      : identityForm.samplePayload
                        ? t('security.webhooks.inbound.sample.sampleAvailable')
                        : t('security.webhooks.inbound.sample.noSample')}
                  </div>
                </div>
                <Button
                  id="inbound-webhook-capture-sample"
                  variant="outline"
                  disabled={!identityForm.inboundWebhookId}
                  onClick={() => void handleCaptureSample()}
                >
                  {t('security.webhooks.inbound.sample.captureButton')}
                </Button>
              </div>
            </div>
            {identityForm.handlerType === 'direct_action' ? (
              <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
                <h4 className="text-sm font-medium text-gray-900">
                  {t('security.webhooks.inbound.handler.directActionTitle')}
                </h4>
                <p className="mt-1 text-sm text-gray-500">
                  {t('security.webhooks.inbound.handler.directActionHelp')}
                </p>
                <div className="mt-4">
                  <CustomSelect
                    id="inbound-webhook-direct-action"
                    label={t('security.webhooks.inbound.handler.action')}
                    value={identityForm.directActionName}
                    placeholder={t('security.webhooks.inbound.handler.actionPlaceholder')}
                    onValueChange={(value) => {
                      setIdentityForm((current) => ({
                        ...current,
                        directActionName: value,
                        fieldMapping: current.directActionName === value ? current.fieldMapping : {},
                      }));
                    }}
                    options={inboundActionOptions}
                  />
                </div>
                {selectedInboundAction ? (
                  <div className="mt-4 space-y-3">
                    <div>
                      <h5 className="text-sm font-medium text-gray-900">
                        {t('security.webhooks.inbound.handler.targetFields')}
                      </h5>
                      <p className="mt-1 text-xs text-gray-500">
                        {selectedInboundAction.description}
                      </p>
                    </div>
                    {selectedInboundAction.targetFields.map((field) => (
                      <div key={field.name} className="rounded-md border border-gray-200 bg-white p-3">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <label
                            htmlFor={`inbound-webhook-mapping-${field.name}`}
                            className="text-sm font-medium text-gray-900"
                          >
                            {field.name}
                          </label>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                            {field.type}
                          </span>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                            {field.required
                              ? t('security.webhooks.inbound.handler.required')
                              : t('security.webhooks.inbound.handler.optional')}
                          </span>
                        </div>
                        <p className="mb-2 text-xs text-gray-500">{field.description}</p>
                        <InboundWebhookMappingField
                          id={`inbound-webhook-mapping-${field.name}`}
                          value={identityForm.fieldMapping[field.name] ?? ''}
                          samplePayload={identityForm.samplePayload}
                          placeholder={t('security.webhooks.inbound.handler.mappingPlaceholder')}
                          onChange={(value) => {
                            setIdentityForm((current) => ({
                              ...current,
                              fieldMapping: {
                                ...current.fieldMapping,
                                [field.name]: value,
                              },
                            }));
                          }}
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
                <h4 className="text-sm font-medium text-gray-900">
                  {t('security.webhooks.inbound.handler.workflowTitle')}
                </h4>
                <p className="mt-1 text-sm text-gray-500">
                  {t('security.webhooks.inbound.handler.workflowHelp')}
                </p>
              </div>
            )}
          </div>
        </DialogContent>
        <DialogFooter>
          <Button
            id="inbound-webhook-identity-cancel"
            variant="ghost"
            onClick={() => setIdentityDialogOpen(false)}
          >
            {t('security.webhooks.inbound.dialog.cancel')}
          </Button>
          <Button
            id="inbound-webhook-identity-save"
            disabled
          >
            {t('security.webhooks.inbound.dialog.saveUnavailable')}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

function OutboundWebhooksSetup() {
  const { t } = useTranslation('msp/profile');
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
  const [isFormDialogOpen, setIsFormDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'deliveries'>('list');
  const [tableCurrentPage, setTableCurrentPage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(10);

  const neverLabel = t('security.webhooks.common.never');
  const noResponseCodeLabel = t('security.webhooks.deliveries.noResponseCode');

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

      const matchedWebhook = preferredWebhookId
        ? nextWebhooks.find((webhook) => webhook.webhookId === preferredWebhookId) ?? null
        : null;

      if (matchedWebhook) {
        setSelectedWebhookId(matchedWebhook.webhookId);
        setFormState(buildFormState(matchedWebhook));
        await loadDeliveries(matchedWebhook.webhookId, 1);
      } else if (preferredWebhookId === null) {
        resetForm();
      }

      setError(null);
    } catch (loadError) {
      console.error('Failed to load webhook settings:', loadError);
      setError(t('security.webhooks.messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [loadDeliveries, resetForm, t]);

  useEffect(() => {
    void loadData(null);
  }, [loadData]);

  const handleNewClick = useCallback(() => {
    resetForm();
    setStatusMessage(null);
    setError(null);
    setIsFormDialogOpen(true);
  }, [resetForm]);

  const handleViewClick = useCallback(async (webhook: WebhookSettingsView) => {
    setSelectedWebhookId(webhook.webhookId);
    setFormState(buildFormState(webhook));
    setRevealedSecret(null);
    setStatusMessage(null);
    setViewMode('deliveries');
    try {
      await loadDeliveries(webhook.webhookId, 1);
      setError(null);
    } catch (loadError) {
      console.error('Failed to load webhook deliveries:', loadError);
      setError(t('security.webhooks.messages.loadDeliveriesFailed'));
    }
  }, [loadDeliveries, t]);

  const handleEditClick = useCallback((webhook: WebhookSettingsView) => {
    setSelectedWebhookId(webhook.webhookId);
    setFormState(buildFormState(webhook));
    setRevealedSecret(null);
    setStatusMessage(null);
    setIsFormDialogOpen(true);
  }, []);

  const handleBackToList = useCallback(() => {
    setViewMode('list');
    setSelectedWebhookId(null);
  }, []);

  const handleDeleteFromRow = useCallback(async (webhook: WebhookSettingsView) => {
    if (!window.confirm(t('security.webhooks.messages.deleteConfirm', { name: webhook.name }))) {
      return;
    }
    try {
      setSaving(true);
      await deleteWebhook(webhook.webhookId);
      await loadData(null);
      setStatusMessage(t('security.webhooks.messages.deleteSuccess'));
      setError(null);
    } catch (deleteError) {
      console.error('Failed to delete webhook:', deleteError);
      setError(deleteError instanceof Error ? deleteError.message : t('security.webhooks.messages.deleteFailed'));
    } finally {
      setSaving(false);
    }
  }, [loadData, t]);

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
        eventTypes: formState.eventTypes as Parameters<typeof upsertWebhook>[0]['eventTypes'],
        customHeaders: parseCustomHeaders(
          formState.customHeadersText,
          (line) => t('security.webhooks.messages.invalidHeaderLine', { line }),
        ),
        entityIds: parseEntityIds(formState.entityIdsText),
        retryConfig: parseRetryConfig(
          formState.retryConfigText,
          t('security.webhooks.messages.invalidRetryConfig'),
        ),
        payloadFields: buildPayloadFieldsForSave(formState.payloadFieldSelection),
        verifySsl: formState.verifySsl,
        // Per-webhook outbound rate limit is intentionally not exposed to
        // tenant admins; the platform default (100/min) applies.
        rateLimitPerMin: 100,
        isActive: formState.isActive,
      });

      const wasUpdate = Boolean(formState.webhookId);
      await loadData(result.webhook.webhookId);
      setFormState(buildFormState(result.webhook));
      setSelectedWebhookId(result.webhook.webhookId);
      setStatusMessage(wasUpdate
        ? t('security.webhooks.messages.updateSuccess')
        : t('security.webhooks.messages.createSuccess'));
      setRevealedSecret(result.signingSecret);
      setIsFormDialogOpen(false);
      setError(null);
    } catch (saveError) {
      console.error('Failed to save webhook:', saveError);
      setError(saveError instanceof Error ? saveError.message : t('security.webhooks.messages.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [formState, loadData, t]);

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
          ? t('security.webhooks.messages.testSuccess', {
              statusCode: result.statusCode ?? noResponseCodeLabel,
            })
          : t('security.webhooks.messages.testFailed', {
              message: result.errorMessage ?? t('security.webhooks.messages.unknownError'),
            }),
      );
      setError(null);
    } catch (testError) {
      console.error('Failed to send webhook test:', testError);
      setError(testError instanceof Error ? testError.message : t('security.webhooks.messages.testRunFailed'));
    } finally {
      setTesting(false);
    }
  }, [loadData, noResponseCodeLabel, selectedWebhook, t]);

  const handleRotateSecret = useCallback(async () => {
    if (!selectedWebhook) {
      return;
    }

    try {
      setRotating(true);
      const result = await rotateWebhookSecret(selectedWebhook.webhookId);
      await loadData(selectedWebhook.webhookId);
      setRevealedSecret(result.signingSecret);
      setStatusMessage(t('security.webhooks.messages.secretRotated'));
      setError(null);
    } catch (rotateError) {
      console.error('Failed to rotate webhook secret:', rotateError);
      setError(rotateError instanceof Error ? rotateError.message : t('security.webhooks.messages.rotateFailed'));
    } finally {
      setRotating(false);
    }
  }, [loadData, selectedWebhook, t]);

  const handleToggleActive = useCallback(async () => {
    if (!selectedWebhook) {
      return;
    }

    try {
      setSaving(true);
      const updated = await setWebhookActiveState(selectedWebhook.webhookId, !selectedWebhook.isActive);
      await loadData(updated.webhookId);
      setStatusMessage(updated.isActive
        ? t('security.webhooks.messages.resumed')
        : t('security.webhooks.messages.paused'));
      setError(null);
    } catch (toggleError) {
      console.error('Failed to update webhook state:', toggleError);
      setError(toggleError instanceof Error ? toggleError.message : t('security.webhooks.messages.stateChangeFailed'));
    } finally {
      setSaving(false);
    }
  }, [loadData, selectedWebhook, t]);

  const handleToggleActiveFor = useCallback(async (webhook: WebhookSettingsView) => {
    try {
      setSaving(true);
      const updated = await setWebhookActiveState(webhook.webhookId, !webhook.isActive);
      await loadData(updated.webhookId);
      setStatusMessage(updated.isActive
        ? t('security.webhooks.messages.resumed')
        : t('security.webhooks.messages.paused'));
      setError(null);
    } catch (toggleError) {
      console.error('Failed to update webhook state:', toggleError);
      setError(toggleError instanceof Error ? toggleError.message : t('security.webhooks.messages.stateChangeFailed'));
    } finally {
      setSaving(false);
    }
  }, [loadData, t]);

  const handleRetryDelivery = useCallback(async (delivery: WebhookDeliveryView) => {
    if (!selectedWebhook) {
      return;
    }

    try {
      await retryWebhookDelivery(selectedWebhook.webhookId, delivery.deliveryId);
      setStatusMessage(t('security.webhooks.messages.retryQueued', { eventId: delivery.eventId }));
      setError(null);
    } catch (retryError) {
      console.error('Failed to retry delivery:', retryError);
      setError(retryError instanceof Error ? retryError.message : t('security.webhooks.messages.retryFailed'));
    }
  }, [selectedWebhook, t]);

  const totalDeliveryPages = deliveries ? Math.max(1, Math.ceil(deliveries.total / deliveries.limit)) : 1;

  const webhookColumns = useMemo<ColumnDefinition<WebhookSettingsView>[]>(() => [
    {
      title: t('security.webhooks.list.columns.name'),
      dataIndex: 'name',
      render: (_value, webhook) => (
        <div>
          <div className="font-medium text-gray-900">{webhook.name}</div>
          <div className="mt-1 break-all text-xs text-gray-500">{webhook.url}</div>
          <div className="mt-1 text-xs text-gray-500">{webhook.eventTypes.join(', ')}</div>
        </div>
      ),
    },
    {
      title: t('security.webhooks.list.columns.status'),
      dataIndex: 'healthStatus',
      render: (_value, webhook) => (
        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${getHealthBadgeClasses(webhook.healthStatus)}`}>
          {t(`security.webhooks.health.${webhook.healthStatus}`, { defaultValue: webhook.healthStatus })}
        </span>
      ),
    },
    {
      title: t('security.webhooks.list.columns.lastDelivery'),
      dataIndex: 'lastDeliveryAt',
      render: (value) => formatDateTime(value as string | null, neverLabel),
    },
    {
      title: t('security.webhooks.list.columns.success'),
      dataIndex: 'successRate',
      render: (value) => formatPercent(value as number),
    },
    {
      title: t('security.webhooks.list.columns.actions'),
      dataIndex: 'webhookId',
      sortable: false,
      width: '64px',
      render: (_value, webhook) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={`webhook-actions-${webhook.webhookId}`}
              variant="ghost"
              className="h-8 w-8 p-0"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleViewClick(webhook)}>
              {t('security.webhooks.list.actions.view')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleEditClick(webhook)}>
              {t('security.webhooks.list.actions.edit')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void handleToggleActiveFor(webhook)}>
              {webhook.isActive
                ? t('security.webhooks.list.actions.pause')
                : t('security.webhooks.list.actions.resume')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void handleDeleteFromRow(webhook)}
              className="text-destructive"
            >
              {t('security.webhooks.form.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ], [handleDeleteFromRow, handleEditClick, handleToggleActiveFor, handleViewClick, neverLabel, t]);

  const handleTablePageSizeChange = useCallback((newPageSize: number) => {
    setTablePageSize(newPageSize);
    setTableCurrentPage(1);
  }, []);

  return (
    <div className="space-y-6">
      {viewMode === 'list' ? (
      <>
      <Card className="p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">{t('security.webhooks.title')}</h2>
            <p className="mt-1 max-w-2xl text-sm text-gray-600">
              {t('security.webhooks.description')}
            </p>
          </div>
          <Button
            id="admin-webhooks-new"
            onClick={handleNewClick}
          >
            {t('security.webhooks.newWebhook')}
          </Button>
        </div>

        {stats ? (
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="text-sm text-gray-500">{t('security.webhooks.stats.total')}</div>
              <div className="mt-2 text-2xl font-semibold">{stats.total}</div>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="text-sm text-gray-500">{t('security.webhooks.stats.active')}</div>
              <div className="mt-2 text-2xl font-semibold">{stats.active}</div>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="text-sm text-gray-500">{t('security.webhooks.stats.autoDisabled')}</div>
              <div className="mt-2 text-2xl font-semibold">{stats.autoDisabled}</div>
            </div>
          </div>
        ) : null}

        <Dialog
          isOpen={revealedSecret !== null}
          onClose={() => setRevealedSecret(null)}
          title={t('security.webhooks.secret.label')}
        >
          <DialogContent>
            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                {t('security.webhooks.secret.warning')}
              </p>
              <div className="rounded-md bg-gray-50 p-4">
                <code className="break-all text-sm">{revealedSecret ?? ''}</code>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  id="webhook-secret-copy"
                  className="w-full"
                  onClick={async () => {
                    if (!revealedSecret) return;
                    try {
                      await navigator.clipboard.writeText(revealedSecret);
                      setStatusMessage(t('security.webhooks.secret.copied'));
                    } catch {
                      setError(t('security.webhooks.secret.copyFailed'));
                    }
                  }}
                >
                  {t('security.webhooks.secret.copy')}
                </Button>
                <Button
                  id="webhook-secret-download"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    if (!revealedSecret) return;
                    // Derive a sensible filename from the selected webhook;
                    // fall back to a generic name when the dialog opens
                    // during create and `selectedWebhook` hasn't refreshed yet.
                    const safeName = (selectedWebhook?.name ?? 'webhook')
                      .toLowerCase()
                      .replace(/[^a-z0-9-_]+/g, '-')
                      .replace(/^-+|-+$/g, '')
                      || 'webhook';
                    const blob = new Blob([revealedSecret], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `${safeName}-signing-secret.txt`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                  }}
                >
                  {t('security.webhooks.secret.download')}
                </Button>
              </div>
              <div className="flex justify-end">
                <Button
                  id="webhook-secret-close"
                  variant="ghost"
                  onClick={() => setRevealedSecret(null)}
                >
                  {t('security.webhooks.secret.close')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

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

      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{t('security.webhooks.list.title')}</h3>
          <div className="text-sm text-gray-500">
            {loading
              ? t('security.webhooks.list.loading')
              : t('security.webhooks.list.configuredCount', { count: webhooks.length })}
          </div>
        </div>

        {webhooks.length === 0 && !loading ? (
          <div className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500">
            {t('security.webhooks.list.empty')}
          </div>
        ) : (
          <DataTable<WebhookSettingsView>
            id="admin-webhooks-table"
            data={webhooks}
            columns={webhookColumns}
            pagination
            currentPage={tableCurrentPage}
            onPageChange={setTableCurrentPage}
            pageSize={tablePageSize}
            onItemsPerPageChange={handleTablePageSizeChange}
            rowClassName={(record) =>
              selectedWebhookId === record.webhookId ? 'bg-primary-50/50' : ''
            }
          />
        )}
      </Card>
      </>
      ) : (
        <Card className="p-6">
          <Button
            id="webhook-back-to-list"
            variant="ghost"
            size="sm"
            onClick={handleBackToList}
            className="mb-4 inline-flex items-center gap-1"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('security.webhooks.detail.back')}
          </Button>

          {statusMessage ? (
            <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              {statusMessage}
            </div>
          ) : null}

          {error ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              {error}
            </div>
          ) : null}

          <DeliveriesTabBody
            selectedWebhook={selectedWebhook}
            deliveries={deliveries}
            deliveryPage={deliveryPage}
            totalDeliveryPages={totalDeliveryPages}
            testing={testing}
            rotating={rotating}
            saving={saving}
            neverLabel={neverLabel}
            noResponseCodeLabel={noResponseCodeLabel}
            onSendTest={handleSendTest}
            onRotateSecret={handleRotateSecret}
            onToggleActive={handleToggleActive}
            onRetry={handleRetryDelivery}
            onLoadDeliveries={loadDeliveries}
            t={t}
          />
        </Card>
      )}


      <Dialog
        isOpen={isFormDialogOpen}
        onClose={() => setIsFormDialogOpen(false)}
        id="webhook-form-dialog"
        title={formState.webhookId
          ? t('security.webhooks.form.editTitle')
          : t('security.webhooks.form.createTitle')}
        className="max-w-2xl"
      >
        <DialogContent>
          <ConfigurationTabBody
            formState={formState}
            eventOptions={eventOptions}
            handleFieldChange={handleFieldChange}
            handleEventToggle={handleEventToggle}
            t={t}
          />
        </DialogContent>
        <DialogFooter>
          <Button
            id="webhook-cancel"
            variant="ghost"
            onClick={() => setIsFormDialogOpen(false)}
            disabled={saving}
          >
            {t('security.webhooks.form.clear')}
          </Button>
          <Button
            id="webhook-save"
            onClick={() => void handleSubmit()}
            disabled={saving}
          >
            {saving
              ? t('security.webhooks.form.saving')
              : formState.webhookId
                ? t('security.webhooks.form.save')
                : t('security.webhooks.form.create')}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

/**
 * Per-entity payload-field allowlist editor. Renders one section per entity
 * the webhook subscribes to (derived from `selectedEventTypes`); each section
 * is a checkbox grid over the registered fields for that entity. Default
 * state for every checkbox is on — unchecking explicitly excludes the field
 * from delivery. The parent component decides on save whether the resulting
 * selection collapses to "full payload" (sentinel `null`) or an explicit map.
 */
function PayloadFieldSelector(props: {
  selectedEventTypes: string[];
  selection: Record<string, string[]>;
  onChange: (next: Record<string, string[]>) => void;
  translate: ReturnType<typeof useTranslation>['t'];
}) {
  const { selectedEventTypes, selection, onChange, translate: t } = props;

  // Only show entities the webhook is actually wired to listen for.
  const relevantEntities = useMemo(() => {
    const set = new Set<string>();
    for (const ev of selectedEventTypes) {
      const entity = entityForEventType(ev);
      if ((WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY as Record<string, readonly string[]>)[entity]) {
        set.add(entity);
      }
    }
    return Array.from(set);
  }, [selectedEventTypes]);

  if (relevantEntities.length === 0) {
    return null;
  }

  function toggleField(entity: string, field: string, checked: boolean) {
    const current = selection[entity] ?? fieldsForEntity(entity);
    const next = checked
      ? Array.from(new Set([...current, field]))
      : current.filter((f) => f !== field);
    onChange({ ...selection, [entity]: next });
  }

  function setEntitySelection(entity: string, fields: string[]) {
    onChange({ ...selection, [entity]: fields });
  }

  return (
    <div className="rounded-md border border-gray-200 p-3">
      <div className="mb-2 text-sm font-medium text-gray-700">
        {t('security.webhooks.form.payloadFields', { defaultValue: 'Delivered fields' })}
      </div>
      <div className="mb-3 text-xs text-gray-500">
        {t('security.webhooks.form.payloadFieldsHelp', {
          defaultValue:
            'All fields are sent by default. Uncheck to exclude a field from delivery. The entity correlation key (e.g. ticket_id) is always included.',
        })}
      </div>

      {relevantEntities.map((entity) => {
        const all = fieldsForEntity(entity);
        const selected = new Set(selection[entity] ?? all);
        const everySelected = all.every((f) => selected.has(f));

        return (
          <div key={entity} className="mb-4 last:mb-0">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                {entity}
              </div>
              <div className="flex gap-3 text-xs">
                <button
                  type="button"
                  className="text-primary-600 hover:underline"
                  onClick={() => setEntitySelection(entity, [...all])}
                  disabled={everySelected}
                >
                  {t('security.webhooks.form.payloadFieldsSelectAll', { defaultValue: 'Select all' })}
                </button>
                <button
                  type="button"
                  className="text-gray-600 hover:underline"
                  onClick={() => setEntitySelection(entity, [])}
                  disabled={selected.size === 0}
                >
                  {t('security.webhooks.form.payloadFieldsClear', { defaultValue: 'Clear' })}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1 md:grid-cols-3">
              {all.map((field) => (
                <Checkbox
                  key={`${entity}-${field}`}
                  id={`webhook-field-${entity}-${field}`}
                  label={field}
                  checked={selected.has(field)}
                  onChange={(event) => toggleField(entity, field, event.target.checked)}
                  containerClassName="mb-0"
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type TFunc = ReturnType<typeof useTranslation>['t'];

function ConfigurationTabBody(props: {
  formState: WebhookFormState;
  eventOptions: string[];
  handleFieldChange: <K extends keyof WebhookFormState>(field: K, value: WebhookFormState[K]) => void;
  handleEventToggle: (eventType: string, checked: boolean) => void;
  t: TFunc;
}) {
  const { formState, eventOptions, handleFieldChange, handleEventToggle, t } = props;
  return (
    <>
      <p className="text-sm text-gray-600 mb-4">
        {t('security.webhooks.form.helper')}
      </p>

      <div className="space-y-4">
        <div>
          <label htmlFor="webhook-name" className="mb-1 block text-sm font-medium text-gray-700">
            {t('security.webhooks.form.name')}
          </label>
          <Input
            id="webhook-name"
            value={formState.name}
            onChange={(event) => handleFieldChange('name', event.target.value)}
            placeholder={t('security.webhooks.form.namePlaceholder')}
          />
        </div>

        <div>
          <label htmlFor="webhook-url" className="mb-1 block text-sm font-medium text-gray-700">
            {t('security.webhooks.form.url')}
          </label>
          <Input
            id="webhook-url"
            value={formState.url}
            onChange={(event) => handleFieldChange('url', event.target.value)}
            placeholder={t('security.webhooks.form.urlPlaceholder')}
          />
        </div>

        <div>
          <div className="mb-2 text-sm font-medium text-gray-700">{t('security.webhooks.form.events')}</div>
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
            {t('security.webhooks.form.customHeaders')}
          </label>
          <textarea
            id="webhook-custom-headers"
            className="min-h-[96px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
            value={formState.customHeadersText}
            onChange={(event) => handleFieldChange('customHeadersText', event.target.value)}
            placeholder={t('security.webhooks.form.customHeadersPlaceholder')}
          />
        </div>

        <div>
          <label htmlFor="webhook-entity-ids" className="mb-1 block text-sm font-medium text-gray-700">
            {t('security.webhooks.form.ticketFilter')}
          </label>
          <textarea
            id="webhook-entity-ids"
            className="min-h-[96px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
            value={formState.entityIdsText}
            onChange={(event) => handleFieldChange('entityIdsText', event.target.value)}
            placeholder={t('security.webhooks.form.ticketFilterPlaceholder')}
          />
        </div>

        <div>
          <label htmlFor="webhook-retry-config" className="mb-1 block text-sm font-medium text-gray-700">
            {t('security.webhooks.form.retryConfig')}
          </label>
          <textarea
            id="webhook-retry-config"
            className="min-h-[96px] w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
            value={formState.retryConfigText}
            onChange={(event) => handleFieldChange('retryConfigText', event.target.value)}
            placeholder={`{\n  "max_attempts": 5,\n  "timeout": 10000\n}`}
          />
        </div>

        <PayloadFieldSelector
          selectedEventTypes={formState.eventTypes}
          selection={formState.payloadFieldSelection}
          onChange={(next) => handleFieldChange('payloadFieldSelection', next)}
          translate={t}
        />

        <div className="flex flex-col gap-2">
          <Checkbox
            id="webhook-verify-ssl"
            label={t('security.webhooks.form.verifySsl')}
            checked={formState.verifySsl}
            onChange={(event) => handleFieldChange('verifySsl', event.target.checked)}
            containerClassName="mb-0"
          />
          <Checkbox
            id="webhook-is-active"
            label={t('security.webhooks.form.webhookActive')}
            checked={formState.isActive}
            onChange={(event) => handleFieldChange('isActive', event.target.checked)}
            containerClassName="mb-0"
          />
        </div>
      </div>
    </>
  );
}

function DeliveriesTabBody(props: {
  selectedWebhook: WebhookSettingsView | null;
  deliveries: WebhookDeliveryPage | null;
  deliveryPage: number;
  totalDeliveryPages: number;
  testing: boolean;
  rotating: boolean;
  saving: boolean;
  neverLabel: string;
  noResponseCodeLabel: string;
  onSendTest: () => void | Promise<void>;
  onRotateSecret: () => void | Promise<void>;
  onToggleActive: () => void | Promise<void>;
  onRetry: (delivery: WebhookDeliveryView) => void | Promise<void>;
  onLoadDeliveries: (webhookId: string, page?: number) => void | Promise<void>;
  t: TFunc;
}) {
  const {
    selectedWebhook, deliveries, deliveryPage, totalDeliveryPages,
    testing, rotating, saving, neverLabel, noResponseCodeLabel,
    onSendTest, onRotateSecret, onToggleActive, onRetry, onLoadDeliveries, t,
  } = props;

  if (!selectedWebhook) return null;

  return (
    <div>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-lg font-semibold">{selectedWebhook.name}</h3>
          <p className="mt-1 break-all text-sm text-gray-600">{selectedWebhook.url}</p>
          <p className="mt-2 text-sm text-gray-600">
            {t('security.webhooks.detail.summary', {
              total: selectedWebhook.totalDeliveries,
              successful: selectedWebhook.successfulDeliveries,
              failed: selectedWebhook.failedDeliveries,
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            id="webhook-test"
            size="sm"
            variant="ghost"
            onClick={() => void onSendTest()}
            disabled={testing}
          >
            {testing
              ? t('security.webhooks.detail.sending')
              : t('security.webhooks.detail.sendTest')}
          </Button>
          <Button
            id="webhook-rotate-secret"
            size="sm"
            variant="ghost"
            onClick={() => void onRotateSecret()}
            disabled={rotating}
          >
            {rotating
              ? t('security.webhooks.detail.rotating')
              : t('security.webhooks.detail.rotateSecret')}
          </Button>
          <Button
            id="webhook-pause-resume"
            size="sm"
            variant="ghost"
            onClick={() => void onToggleActive()}
            disabled={saving}
          >
            {selectedWebhook.isActive
              ? t('security.webhooks.list.actions.pause')
              : t('security.webhooks.list.actions.resume')}
          </Button>
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            {t('security.webhooks.deliveries.title')}
          </h4>
          <div className="text-xs text-gray-500">
            {t('security.webhooks.deliveries.page', { page: deliveryPage, total: totalDeliveryPages })}
          </div>
        </div>

        {!deliveries || deliveries.data.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500">
            {t('security.webhooks.deliveries.empty')}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="py-2 pr-4 font-medium">{t('security.webhooks.deliveries.columns.event')}</th>
                    <th className="py-2 pr-4 font-medium">{t('security.webhooks.deliveries.columns.status')}</th>
                    <th className="py-2 pr-4 font-medium">{t('security.webhooks.deliveries.columns.attempted')}</th>
                    <th className="py-2 pr-4 font-medium">{t('security.webhooks.deliveries.columns.response')}</th>
                    <th className="py-2 pr-4 font-medium">{t('security.webhooks.deliveries.columns.action')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {deliveries.data.map((delivery) => (
                    <tr key={delivery.deliveryId}>
                      <td className="py-3 pr-4 align-top">
                        <div className="font-medium text-gray-900">{delivery.eventType}</div>
                        <div className="mt-1 break-all text-xs text-gray-500">{delivery.eventId}</div>
                        {delivery.isTest ? (
                          <div className="mt-1 text-xs text-blue-600">{t('security.webhooks.deliveries.testBadge')}</div>
                        ) : null}
                      </td>
                      <td className="py-3 pr-4 align-top">
                        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${getDeliveryBadgeClasses(delivery.status)}`}>
                          {t(`security.webhooks.deliveryStatus.${delivery.status}`, { defaultValue: delivery.status })}
                        </span>
                        <div className="mt-1 text-xs text-gray-500">
                          {t('security.webhooks.deliveries.attempt', { number: delivery.attemptNumber })}
                        </div>
                      </td>
                      <td className="py-3 pr-4 align-top text-gray-700">
                        {formatDateTime(delivery.attemptedAt, neverLabel)}
                      </td>
                      <td className="py-3 pr-4 align-top">
                        <div className="text-gray-700">
                          {delivery.responseStatusCode ?? noResponseCodeLabel}
                          {delivery.durationMs !== null ? ` • ${delivery.durationMs} ms` : ''}
                        </div>
                        <div className="mt-1 max-w-md whitespace-pre-wrap break-words text-xs text-gray-500">
                          {delivery.errorMessage ?? delivery.responseBody ?? t('security.webhooks.deliveries.noResponseBody')}
                        </div>
                      </td>
                      <td className="py-3 pr-0 align-top">
                        {!delivery.isTest ? (
                          <Button
                            id={`retry-delivery-${delivery.deliveryId}`}
                            size="sm"
                            variant="ghost"
                            onClick={() => void onRetry(delivery)}
                          >
                            {t('security.webhooks.deliveries.retry')}
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
                  if (deliveryPage > 1) {
                    void onLoadDeliveries(selectedWebhook.webhookId, deliveryPage - 1);
                  }
                }}
                disabled={deliveryPage <= 1}
              >
                {t('security.webhooks.deliveries.previous')}
              </Button>
              <Button
                id="webhook-deliveries-next"
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (deliveryPage < totalDeliveryPages) {
                    void onLoadDeliveries(selectedWebhook.webhookId, deliveryPage + 1);
                  }
                }}
                disabled={deliveryPage >= totalDeliveryPages}
              >
                {t('security.webhooks.deliveries.next')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
