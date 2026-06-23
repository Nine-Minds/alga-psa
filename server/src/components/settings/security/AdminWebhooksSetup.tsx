'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Switch } from '@alga-psa/ui/components/Switch';
import Drawer from '@alga-psa/ui/components/Drawer';
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from '@alga-psa/ui/components/Dialog';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import ViewSwitcher, { type ViewSwitcherOption } from '@alga-psa/ui/components/ViewSwitcher';
import { ArrowLeft, MoreVertical } from 'lucide-react';
import type { ColumnDefinition } from '@alga-psa/types';
import { buildTenantPortalSlug } from '@alga-psa/validation';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { isEnterprise } from '@alga-psa/core/features';
import { buildWebhookPayloadExpressionPathOptions } from '@shared/workflow/expression-authoring/adapters/webhookPayloadContextAdapter';
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
  listInboundWorkflowOptions,
  listInboundWebhooks,
  replayInboundDelivery,
  rotateInboundWebhookSecret,
  sendInboundWebhookTest,
  setInboundWebhookActiveState,
  upsertInboundWebhook,
  type InboundActionDefinitionView,
  type InboundWorkflowOptionView,
} from '@/lib/actions/inboundWebhookActions';
import { WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY } from '@/lib/webhooks/payloadFields';
import type {
  InboundWebhookConfig,
  InboundWebhookDelivery,
  InboundWebhookDispatchStatus,
} from '@/lib/inboundWebhooks/types';
import { InboundWebhookMappingField } from './inbound/InboundWebhookMappingField';
import { InboundWebhookMappingFieldRow } from './inbound/InboundWebhookMappingFieldRow';
import { parseFieldMappingValue } from '@/lib/inboundWebhooks/fieldMappingMode';

const inboundWebhookWorkflowHandlersEnabled = isEnterprise;

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
  isActive: boolean;
  autoDisabledAt: string | Date | null;
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

function formatJsonForDisplay(value: unknown): string {
  if (value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value, null, 2);
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

function getInboundDeliveryStatusBadgeVariant(status: InboundWebhookDispatchStatus): BadgeVariant {
  if (status === 'dispatched') {
    return 'success';
  }
  if (status === 'failed') {
    return 'error';
  }
  if (status === 'pending') {
    return 'warning';
  }
  return 'info';
}

export default function AdminWebhooksSetup() {
  const { t } = useTranslation('msp/profile');
  const [activeTab, setActiveTab] = useState<'inbound' | 'outbound'>('outbound');

  const viewOptions: ViewSwitcherOption<'inbound' | 'outbound'>[] = [
    { value: 'inbound', label: t('security.webhooks.tabs.inbound'), id: 'webhooks-inbound-view-btn' },
    { value: 'outbound', label: t('security.webhooks.tabs.outbound'), id: 'webhooks-outbound-view-btn' },
  ];

  return (
    <div>
      <div className="mb-6 inline-block">
        <ViewSwitcher
          currentView={activeTab}
          onChange={setActiveTab}
          options={viewOptions}
          className="inline-flex"
          aria-label={t('security.webhooks.title')}
        />
      </div>
      {activeTab === 'inbound' ? (
        <InboundWebhooksListView />
      ) : (
        <OutboundWebhooksSetup />
      )}
    </div>
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

function splitLines(input: string): string[] {
  return input
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function buildInboundWebhookUpsertPayload(form: InboundWebhookIdentityFormState): Record<string, unknown> {
  const authConfig = (() => {
    switch (form.authType) {
      case 'hmac_sha256':
        return {
          type: 'hmac_sha256',
          signature_header: form.hmacSignatureHeader,
        };
      case 'bearer':
        return {
          type: 'bearer',
          ...(form.bearerToken.trim() ? { token: form.bearerToken.trim() } : {}),
        };
      case 'ip_allowlist':
        return {
          type: 'ip_allowlist',
          ip_cidrs: splitLines(form.ipCidrs),
        };
      case 'path_token':
        return {
          type: 'path_token',
          query_param: form.pathTokenQueryParam.trim() || 'token',
          ...(form.pathToken.trim() ? { token: form.pathToken.trim() } : {}),
        };
      default:
        return { type: form.authType };
    }
  })();

  const handlerConfig = form.handlerType === 'workflow'
    ? {
        type: 'workflow',
        workflow_id: form.workflowId,
      }
    : {
        type: 'direct_action',
        action: form.directActionName,
        // Drop empty entries so optional fields don't trip the server's min(1) value check.
        field_mapping: Object.fromEntries(
          Object.entries(form.fieldMapping).filter(([, value]) => typeof value === 'string' && value.trim() !== ''),
        ),
      };

  return {
    ...(form.inboundWebhookId ? { inbound_webhook_id: form.inboundWebhookId } : {}),
    name: form.name,
    slug: form.slug,
    description: form.description || null,
    auth_type: form.authType,
    auth_config: authConfig,
    idempotency_source: form.idempotencyValue.trim()
      ? {
          type: form.idempotencyType,
          value: form.idempotencyValue.trim(),
        }
      : null,
    idempotency_window_seconds: form.idempotencyWindowSeconds,
    handler_type: form.handlerType,
    handler_config: handlerConfig,
    is_active: form.isActive,
  };
}

function validateInboundWebhookForm(
  form: InboundWebhookIdentityFormState,
  selectedAction: InboundActionDefinitionView | null,
  t: ReturnType<typeof useTranslation>['t'],
): string | null {
  if (!form.name.trim()) {
    return t('security.webhooks.inbound.messages.nameRequired');
  }
  if (!form.slug.trim()) {
    return t('security.webhooks.inbound.messages.slugRequired');
  }
  if (form.handlerType === 'workflow') {
    if (!form.workflowId.trim()) {
      return t('security.webhooks.inbound.messages.workflowRequired');
    }
    return null;
  }
  if (form.handlerType === 'direct_action') {
    if (!form.directActionName.trim()) {
      return t('security.webhooks.inbound.messages.actionRequired');
    }
    if (selectedAction) {
      const missingRequired = selectedAction.targetFields
        .filter((field) => field.required)
        .filter((field) => {
          const raw = form.fieldMapping[field.name];
          return !raw || (typeof raw === 'string' && raw.trim() === '');
        });
      if (missingRequired.length > 0) {
        return t('security.webhooks.inbound.messages.missingRequiredFields', {
          fields: missingRequired.map((field) => field.name).join(', '),
        });
      }
    }
  }
  return null;
}

function formatInboundUpsertError(
  error: unknown,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (error instanceof Error) {
    const message = error.message;
    // Server actions surface Zod validation as a JSON array string.
    if (message.trim().startsWith('[')) {
      try {
        const issues = JSON.parse(message) as Array<{ path?: unknown[]; message?: string }>;
        if (Array.isArray(issues) && issues.length > 0) {
          return issues
            .map((issue) => {
              const path = Array.isArray(issue.path) && issue.path.length > 0
                ? issue.path.join('.')
                : '';
              return path ? `${path}: ${issue.message}` : issue.message ?? '';
            })
            .filter(Boolean)
            .join('\n');
        }
      } catch {
        // fall through to raw message
      }
    }
    return message;
  }
  return t('security.webhooks.messages.saveFailed');
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
  const [workflowOptions, setWorkflowOptions] = useState<InboundWorkflowOptionView[]>([]);
  const [inboundDeliveryPage, setInboundDeliveryPage] = useState<{
    data: InboundWebhookDelivery[];
    page: number;
    limit: number;
    total: number;
  } | null>(null);
  const [inboundDeliveryPageNumber, setInboundDeliveryPageNumber] = useState(1);
  const [inboundDeliveryStatusFilter, setInboundDeliveryStatusFilter] = useState<InboundWebhookDispatchStatus | 'all'>('all');
  const [selectedInboundDelivery, setSelectedInboundDelivery] = useState<InboundWebhookDelivery | null>(null);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testBodyText, setTestBodyText] = useState('{\n  "id": "sample-1"\n}');
  const [testHeadersText, setTestHeadersText] = useState('Content-Type: application/json');
  const [lastDeliveries, setLastDeliveries] = useState<Record<string, InboundWebhookDelivery | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // LEVERAGE: friction datatable-client-paging — re-derives page/size state + reset handler DataTable already owns internally
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
    isActive: true,
    autoDisabledAt: null,
  });
  const [revealedInboundSecret, setRevealedInboundSecret] = useState<{
    webhookName: string;
    secret: string;
  } | null>(null);
  const [focusedMappingField, setFocusedMappingField] = useState<string | null>(null);
  const [inboundViewMode, setInboundViewMode] = useState<'list' | 'deliveries'>('list');
  const [viewWebhookId, setViewWebhookId] = useState<string | null>(null);
  const [replayConfirmDeliveryId, setReplayConfirmDeliveryId] = useState<string | null>(null);
  const [isReplayInFlight, setIsReplayInFlight] = useState(false);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const neverLabel = t('security.webhooks.common.never');

  const loadInboundWebhooks = useCallback(async () => {
    try {
      setLoading(true);
      const [configs, actionDefinitions, workflows] = await Promise.all([
        listInboundWebhooks(),
        listInboundWebhookActions(),
        inboundWebhookWorkflowHandlersEnabled ? listInboundWorkflowOptions() : Promise.resolve([]),
      ]);
      setWebhooks(configs);
      setInboundActions(actionDefinitions);
      setWorkflowOptions(workflows);
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

  const loadInboundDialogDeliveries = useCallback(async (
    webhookId: string,
    page: number,
    status: InboundWebhookDispatchStatus | 'all',
  ) => {
    try {
      const deliveriesPage = await listInboundDeliveries({
        inboundWebhookId: webhookId,
        status: status === 'all' ? undefined : status,
      }, page, 10);
      setInboundDeliveryPage(deliveriesPage);
      setError(null);
    } catch (deliveryError) {
      console.error('Failed to load inbound webhook deliveries:', deliveryError);
      setError(deliveryError instanceof Error ? deliveryError.message : t('security.webhooks.inbound.deliveryLog.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    const activeWebhookId =
      inboundViewMode === 'deliveries'
        ? viewWebhookId
        : identityDialogOpen
          ? identityForm.inboundWebhookId
          : null;

    if (!activeWebhookId) {
      setInboundDeliveryPage(null);
      setInboundDeliveryPageNumber(1);
      setInboundDeliveryStatusFilter('all');
      return;
    }

    void loadInboundDialogDeliveries(activeWebhookId, inboundDeliveryPageNumber, inboundDeliveryStatusFilter);
  }, [identityDialogOpen, identityForm.inboundWebhookId, inboundDeliveryPageNumber, inboundDeliveryStatusFilter, inboundViewMode, loadInboundDialogDeliveries, viewWebhookId]);

  const handleInboundViewClick = useCallback(async (webhook: InboundWebhookConfig) => {
    setViewWebhookId(webhook.inboundWebhookId);
    setInboundViewMode('deliveries');
    setInboundDeliveryPageNumber(1);
    setInboundDeliveryStatusFilter('all');
    try {
      await loadInboundDialogDeliveries(webhook.inboundWebhookId, 1, 'all');
      setError(null);
    } catch (loadError) {
      console.error('Failed to load inbound webhook deliveries:', loadError);
      setError(t('security.webhooks.inbound.messages.loadFailed'));
    }
  }, [loadInboundDialogDeliveries, t]);

  const handleBackToInboundList = useCallback(() => {
    setInboundViewMode('list');
    setViewWebhookId(null);
    setSelectedInboundDelivery(null);
  }, []);

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
            <DropdownMenuItem
              id={`inbound-webhook-view-${webhook.inboundWebhookId}`}
              onClick={() => void handleInboundViewClick(webhook)}
            >
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
                  isActive: webhook.isActive,
                  autoDisabledAt: webhook.autoDisabledAt,
                });
                setSlugManuallyEdited(true);
                setIdentityDialogOpen(true);
              }}
            >
              {t('security.webhooks.list.actions.edit')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ], [handleInboundViewClick, lastDeliveries, neverLabel, t]);

  const handleTablePageSizeChange = useCallback((newPageSize: number) => {
    setTablePageSize(newPageSize);
    setTableCurrentPage(1);
  }, []);

  const handleNewInboundWebhook = useCallback(() => {
    setSlugManuallyEdited(false);
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
      isActive: true,
      autoDisabledAt: null,
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

  const handlerTypeOptions = useMemo(() => {
    const options = [
      { value: 'direct_action', label: t('security.webhooks.inbound.handler.types.directAction') },
    ];

    if (inboundWebhookWorkflowHandlersEnabled) {
      options.push({ value: 'workflow', label: t('security.webhooks.inbound.handler.types.workflow') });
    }

    return options;
  }, [t]);

  const inboundActionOptions = useMemo(() => inboundActions.map((action) => ({
    value: action.name,
    label: `${action.entityType}: ${action.displayName}`,
  })), [inboundActions]);

  const workflowSelectOptions = useMemo(() => workflowOptions.map((workflow) => ({
    value: workflow.workflowId,
    label: workflow.name,
    dropdownHint: workflow.description ?? workflow.status ?? undefined,
  })), [workflowOptions]);

  const selectedInboundAction = useMemo(
    () => inboundActions.find((action) => action.name === identityForm.directActionName) ?? null,
    [identityForm.directActionName, inboundActions],
  );

  const resolveStaticFieldValue = useCallback(
    (fieldName: string): string | undefined => {
      const field = selectedInboundAction?.targetFields.find((entry) => entry.name === fieldName);
      const raw = identityForm.fieldMapping[fieldName];
      if (!raw || !field) {
        return undefined;
      }
      const parsed = parseFieldMappingValue(raw, field.type);
      return parsed.mode === 'static' && parsed.staticValue ? parsed.staticValue : undefined;
    },
    [identityForm.fieldMapping, selectedInboundAction],
  );

  const inboundDeliveryColumns = useMemo<ColumnDefinition<InboundWebhookDelivery>[]>(() => [
    {
      title: t('security.webhooks.inbound.deliveryLog.columns.received'),
      dataIndex: 'receivedAt',
      render: (value) => formatDateTime(value as string | null, neverLabel),
    },
    {
      title: t('security.webhooks.inbound.deliveryLog.columns.status'),
      dataIndex: 'dispatchStatus',
      render: (value) => (
        <Badge
          variant={getInboundDeliveryStatusBadgeVariant(value as InboundWebhookDispatchStatus)}
          size="sm"
        >
          {t(`security.webhooks.inbound.deliveryLog.status.${value as string}`, { defaultValue: value as string })}
        </Badge>
      ),
    },
    {
      title: t('security.webhooks.inbound.deliveryLog.columns.response'),
      dataIndex: 'responseStatus',
      render: (value) => value ?? t('security.webhooks.deliveries.noResponseCode'),
    },
    {
      title: t('security.webhooks.inbound.deliveryLog.columns.duration'),
      dataIndex: 'durationMs',
      render: (value) => value == null
        ? t('security.webhooks.deliveries.noResponseCode')
        : t('security.webhooks.inbound.deliveryLog.durationMs', { duration: value as number }),
    },
    {
      title: t('security.webhooks.inbound.deliveryLog.columns.actions'),
      dataIndex: 'deliveryId',
      sortable: false,
      width: '80px',
      render: (_value, delivery) => (
        <Button
          id={`inbound-webhook-delivery-view-${delivery.deliveryId}`}
          variant="ghost"
          size="sm"
          onClick={() => setSelectedInboundDelivery(delivery)}
        >
          {t('security.webhooks.inbound.deliveryLog.view')}
        </Button>
      ),
    },
  ], [neverLabel, t]);

  const inboundDeliveryStatusOptions = useMemo(() => [
    { value: 'all', label: t('security.webhooks.inbound.deliveryLog.allStatuses') },
    { value: 'pending', label: t('security.webhooks.inbound.deliveryLog.status.pending') },
    { value: 'dispatched', label: t('security.webhooks.inbound.deliveryLog.status.dispatched') },
    { value: 'duplicate', label: t('security.webhooks.inbound.deliveryLog.status.duplicate') },
    { value: 'failed', label: t('security.webhooks.inbound.deliveryLog.status.failed') },
  ], [t]);

  const samplePathOptions = useMemo(
    () => buildWebhookPayloadExpressionPathOptions(identityForm.samplePayload, { includeRootPaths: true }),
    [identityForm.samplePayload],
  );

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!identityForm.sampleCaptureExpiresAt) {
      return undefined;
    }
    const expiresAt = new Date(identityForm.sampleCaptureExpiresAt).getTime();
    if (expiresAt <= Date.now()) {
      return undefined;
    }
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [identityForm.sampleCaptureExpiresAt]);

  const sampleCaptureActive = identityForm.sampleCaptureExpiresAt
    ? new Date(identityForm.sampleCaptureExpiresAt).getTime() > now
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

  const handleInsertSamplePath = useCallback((path: string) => {
    if (!focusedMappingField) {
      return;
    }

    setIdentityForm((current) => ({
      ...current,
      fieldMapping: {
        ...current.fieldMapping,
        [focusedMappingField]: path,
      },
    }));
  }, [focusedMappingField]);

  const handleInboundActiveChange = useCallback(async (checked: boolean) => {
    if (!identityForm.inboundWebhookId) {
      setIdentityForm((current) => ({
        ...current,
        isActive: checked,
      }));
      return;
    }

    try {
      const updated = await setInboundWebhookActiveState(identityForm.inboundWebhookId, checked);
      setIdentityForm((current) => ({
        ...current,
        isActive: updated.isActive,
        autoDisabledAt: updated.autoDisabledAt,
      }));
      setWebhooks((current) => current.map((webhook) => (
        webhook.inboundWebhookId === updated.inboundWebhookId ? updated : webhook
      )));
      setError(null);
    } catch (toggleError) {
      console.error('Failed to update inbound webhook active state:', toggleError);
      setError(toggleError instanceof Error ? toggleError.message : t('security.webhooks.inbound.active.updateFailed'));
    }
  }, [identityForm.inboundWebhookId, t]);

  const handleReplayInboundDelivery = useCallback((deliveryId: string) => {
    setReplayConfirmDeliveryId(deliveryId);
  }, []);

  const handleConfirmReplay = useCallback(async () => {
    if (!replayConfirmDeliveryId) {
      return;
    }
    setIsReplayInFlight(true);
    try {
      const replayed = await replayInboundDelivery(replayConfirmDeliveryId);
      setSelectedInboundDelivery(replayed);
      const reloadTargetId = viewWebhookId ?? identityForm.inboundWebhookId;
      if (reloadTargetId) {
        await loadInboundDialogDeliveries(reloadTargetId, inboundDeliveryPageNumber, inboundDeliveryStatusFilter);
      }
      setError(null);
      setReplayConfirmDeliveryId(null);
    } catch (replayError) {
      console.error('Failed to replay inbound webhook delivery:', replayError);
      setError(replayError instanceof Error ? replayError.message : t('security.webhooks.inbound.deliveryDetail.replayFailed'));
    } finally {
      setIsReplayInFlight(false);
    }
  }, [identityForm.inboundWebhookId, inboundDeliveryPageNumber, inboundDeliveryStatusFilter, loadInboundDialogDeliveries, replayConfirmDeliveryId, t, viewWebhookId]);

  const handleSendInboundTest = useCallback(async () => {
    if (!identityForm.inboundWebhookId) {
      return;
    }

    try {
      const body = testBodyText.trim() ? JSON.parse(testBodyText) : {};
      const headers = parseCustomHeaders(
        testHeadersText,
        (line) => t('security.webhooks.messages.invalidHeaderLine', { line }),
      );
      const delivery = await sendInboundWebhookTest(identityForm.inboundWebhookId, { body, headers });
      setSelectedInboundDelivery(delivery);
      setTestDialogOpen(false);
      await loadInboundDialogDeliveries(identityForm.inboundWebhookId, inboundDeliveryPageNumber, inboundDeliveryStatusFilter);
      setError(null);
    } catch (testError) {
      console.error('Failed to send inbound webhook test:', testError);
      setError(testError instanceof Error ? testError.message : t('security.webhooks.inbound.test.sendFailed'));
    }
  }, [identityForm.inboundWebhookId, inboundDeliveryPageNumber, inboundDeliveryStatusFilter, loadInboundDialogDeliveries, t, testBodyText, testHeadersText]);

  const handleSaveInboundWebhook = useCallback(async () => {
    // Pre-submit validation surfaces friendly errors instead of raw Zod issue arrays.
    const validationError = validateInboundWebhookForm(identityForm, selectedInboundAction, t);
    if (validationError) {
      setError(validationError);
      return;
    }
    try {
      const result = await upsertInboundWebhook(buildInboundWebhookUpsertPayload(identityForm));
      setIdentityForm((current) => ({
        ...current,
        inboundWebhookId: result.webhook.inboundWebhookId,
        samplePayload: result.webhook.samplePayload,
        sampleCaptureExpiresAt: result.webhook.sampleCaptureExpiresAt,
        autoDisabledAt: result.webhook.autoDisabledAt,
      }));
      setWebhooks((current) => {
        const existingIndex = current.findIndex((webhook) => webhook.inboundWebhookId === result.webhook.inboundWebhookId);
        if (existingIndex === -1) {
          return [...current, result.webhook];
        }
        return current.map((webhook) => (
          webhook.inboundWebhookId === result.webhook.inboundWebhookId ? result.webhook : webhook
        ));
      });
      setIdentityDialogOpen(false);
      if (result.secret) {
        setRevealedInboundSecret({
          webhookName: result.webhook.name,
          secret: result.secret,
        });
      }
      setError(null);
    } catch (saveError) {
      console.error('Failed to save inbound webhook:', saveError);
      setError(formatInboundUpsertError(saveError, t));
    }
  }, [identityForm, selectedInboundAction, t]);

  const handleRotateInboundSecret = useCallback(async () => {
    if (!identityForm.inboundWebhookId || identityForm.authType === 'ip_allowlist') {
      return;
    }

    try {
      const result = await rotateInboundWebhookSecret(identityForm.inboundWebhookId);
      setWebhooks((current) => current.map((webhook) => (
        webhook.inboundWebhookId === result.webhook.inboundWebhookId ? result.webhook : webhook
      )));
      setRevealedInboundSecret({
        webhookName: result.webhook.name,
        secret: result.secret,
      });
      setError(null);
    } catch (rotateError) {
      console.error('Failed to rotate inbound webhook secret:', rotateError);
      setError(rotateError instanceof Error ? rotateError.message : t('security.webhooks.messages.rotateFailed'));
    }
  }, [identityForm.authType, identityForm.inboundWebhookId, t]);

  const viewingWebhook = useMemo(
    () => (viewWebhookId ? webhooks.find((w) => w.inboundWebhookId === viewWebhookId) ?? null : null),
    [viewWebhookId, webhooks],
  );

  return (
    <div className="space-y-6">
      {inboundViewMode === 'list' ? (
        <>
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
        </>
      ) : (
        <Card className="p-6">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="flex items-start gap-3">
              <Button
                id="inbound-webhook-deliveries-back"
                variant="ghost"
                onClick={handleBackToInboundList}
                className="h-9 w-9 p-0"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <h2 className="text-xl font-semibold">
                  {t('security.webhooks.inbound.deliveryLog.title')}
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  {viewingWebhook?.name ?? ''}
                </p>
                {viewingWebhook ? (
                  <p className="mt-1 font-mono text-xs text-gray-500">{viewingWebhook.slug}</p>
                ) : null}
              </div>
            </div>
            <div className="max-w-xs">
              <CustomSelect
                id="inbound-webhook-deliveries-status-filter"
                label={t('security.webhooks.inbound.deliveryLog.columns.status')}
                value={inboundDeliveryStatusFilter}
                onValueChange={(value) => {
                  setInboundDeliveryStatusFilter(value as InboundWebhookDispatchStatus | 'all');
                  setInboundDeliveryPageNumber(1);
                }}
                options={inboundDeliveryStatusOptions}
              />
            </div>
          </div>

          {error ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              {error}
            </div>
          ) : null}

          {inboundDeliveryPage && inboundDeliveryPage.data.length > 0 ? (
            <DataTable<InboundWebhookDelivery>
              id="inbound-webhook-deliveries-page-table"
              data={inboundDeliveryPage.data}
              columns={inboundDeliveryColumns}
              pagination
              currentPage={inboundDeliveryPageNumber}
              onPageChange={setInboundDeliveryPageNumber}
              pageSize={inboundDeliveryPage.limit}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500">
              {t('security.webhooks.inbound.deliveryLog.empty')}
            </div>
          )}
        </Card>
      )}

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
                  slug: slugManuallyEdited ? current.slug : slugifyInboundWebhookName(nextName),
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
                setSlugManuallyEdited(true);
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
            {identityForm.inboundWebhookId && identityForm.authType !== 'ip_allowlist' ? (
              <Button
                id="inbound-webhook-auth-rotate-secret"
                variant="outline"
                onClick={() => void handleRotateInboundSecret()}
              >
                {t('security.webhooks.detail.rotateSecret')}
              </Button>
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
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">
                    {t('security.webhooks.inbound.active.title')}
                  </h3>
                  <p className="mt-1 text-sm text-gray-500">
                    {t('security.webhooks.inbound.active.help')}
                  </p>
                </div>
                <Switch
                  id="inbound-webhook-active"
                  label={t('security.webhooks.inbound.active.toggle')}
                  checked={identityForm.isActive}
                  onCheckedChange={(checked) => void handleInboundActiveChange(checked)}
                />
              </div>
              {identityForm.autoDisabledAt ? (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {t('security.webhooks.inbound.active.autoDisabled', {
                    date: formatDateTime(identityForm.autoDisabledAt as string, neverLabel),
                  })}
                </div>
              ) : null}
            </div>
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
                const nextType = value as InboundWebhookConfig['handlerType'];
                if (nextType === 'workflow' && !inboundWebhookWorkflowHandlersEnabled) {
                  return;
                }
                setIdentityForm((current) => {
                  if (current.handlerType === nextType) {
                    return current;
                  }
                  return {
                    ...current,
                    handlerType: nextType,
                    directActionName: nextType === 'direct_action' ? current.directActionName : '',
                    fieldMapping: nextType === 'direct_action' ? current.fieldMapping : {},
                    workflowId: nextType === 'workflow' ? current.workflowId : '',
                  };
                });
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
                <Button
                  id="inbound-webhook-open-test"
                  variant="outline"
                  disabled={!identityForm.inboundWebhookId}
                  onClick={() => setTestDialogOpen(true)}
                >
                  {t('security.webhooks.inbound.test.openButton')}
                </Button>
              </div>
            </div>
            {identityForm.handlerType === 'direct_action' || !inboundWebhookWorkflowHandlersEnabled ? (
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
                  {inboundActionOptions.length === 0 ? (
                    <p
                      id="inbound-webhook-direct-action-empty"
                      className="mt-2 text-xs text-amber-700"
                    >
                      {t('security.webhooks.inbound.handler.actionEmpty')}
                    </p>
                  ) : null}
                </div>
                {selectedInboundAction ? (
                  <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
                    <div className="space-y-3">
                      <div>
                        <h5 className="text-sm font-medium text-gray-900">
                          {t('security.webhooks.inbound.handler.targetFields')}
                        </h5>
                        <p className="mt-1 text-xs text-gray-500">
                          {selectedInboundAction.description}
                        </p>
                      </div>
                      {selectedInboundAction.targetFields.map((field) => {
                        const isMissingRequired =
                          field.required && !(identityForm.fieldMapping[field.name] ?? '').trim();
                        return (
                        <div
                          key={field.name}
                          className={`rounded-md border bg-white p-3 ${
                            isMissingRequired ? 'border-red-300' : 'border-gray-200'
                          }`}
                        >
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <label
                              htmlFor={`inbound-webhook-mapping-${field.name}`}
                              className="text-sm font-medium text-gray-900"
                            >
                              {field.name}
                              {field.required ? (
                                <span aria-hidden="true" className="ml-1 text-red-600">*</span>
                              ) : null}
                            </label>
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                              {t(`security.webhooks.inbound.handler.fieldTypes.${field.type}`, {
                                defaultValue: field.type,
                              })}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs ${
                                field.required ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {field.required
                                ? t('security.webhooks.inbound.handler.required')
                                : t('security.webhooks.inbound.handler.optional')}
                            </span>
                          </div>
                          <p className="mb-2 text-xs text-gray-500">{field.description}</p>
                          <InboundWebhookMappingFieldRow
                            field={field}
                            value={identityForm.fieldMapping[field.name] ?? ''}
                            samplePayload={identityForm.samplePayload}
                            onFocusExpression={(fieldName) => setFocusedMappingField(fieldName)}
                            scope={{
                              board_id: resolveStaticFieldValue('board_id'),
                              client_id: resolveStaticFieldValue('client_id'),
                              parent_category_id: resolveStaticFieldValue('category_id'),
                            }}
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
                        );
                      })}
                    </div>
                    <div className="rounded-md border border-gray-200 bg-white p-3">
                      <h5 className="text-sm font-medium text-gray-900">
                        {t('security.webhooks.inbound.sampleTree.title')}
                      </h5>
                      <p className="mt-1 text-xs text-gray-500">
                        {focusedMappingField
                          ? t('security.webhooks.inbound.sampleTree.help', { field: focusedMappingField })
                          : t('security.webhooks.inbound.sampleTree.focusHelp')}
                      </p>
                      {samplePathOptions.length === 0 ? (
                        <div className="mt-3 rounded-md border border-dashed border-gray-300 p-3 text-xs text-gray-500">
                          {t('security.webhooks.inbound.sampleTree.empty')}
                        </div>
                      ) : (
                        <div className="mt-3 max-h-80 space-y-1 overflow-y-auto pr-1">
                          {samplePathOptions.map((option) => (
                            <button
                              key={option.path}
                              id={`inbound-webhook-sample-path-${option.path.replace(/[^a-zA-Z0-9_-]+/g, '-')}`}
                              type="button"
                              className="block w-full rounded px-2 py-1 text-left font-mono text-xs text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-400"
                              style={{ paddingLeft: `${Math.max(0, option.path.split('.').length - 1) * 12 + 8}px` }}
                              disabled={!focusedMappingField}
                              onClick={() => handleInsertSamplePath(option.path)}
                            >
                              {option.path}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
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
                <div className="mt-4">
                  <CustomSelect
                    id="inbound-webhook-workflow"
                    label={t('security.webhooks.inbound.handler.workflow')}
                    value={identityForm.workflowId}
                    placeholder={t('security.webhooks.inbound.handler.workflowPlaceholder')}
                    onValueChange={(value) => {
                      setIdentityForm((current) => ({
                        ...current,
                        workflowId: value,
                      }));
                    }}
                    options={workflowSelectOptions}
                  />
                  {workflowSelectOptions.length === 0 ? (
                    <p
                      id="inbound-webhook-workflow-empty"
                      className="mt-2 text-xs text-amber-700"
                    >
                      {t('security.webhooks.inbound.handler.workflowEmpty')}
                    </p>
                  ) : null}
                </div>
                <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3">
                  <h5 className="text-sm font-medium text-blue-950">
                    {t('security.webhooks.inbound.handler.envelopeTitle')}
                  </h5>
                  <pre className="mt-2 overflow-x-auto rounded bg-white p-3 text-xs text-blue-950">
{`{
  "source": "<webhook_slug>",
  "body": { },
  "headers": { },
  "verified": true,
  "delivery_id": "<delivery_id>",
  "idempotency_key": "<key>",
  "received_at": "<iso_timestamp>"
}`}
                  </pre>
                </div>
              </div>
            )}
            {identityForm.inboundWebhookId ? (
              <div className="border-t border-gray-200 pt-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">
                      {t('security.webhooks.inbound.deliveryLog.title')}
                    </h3>
                    <p className="mt-1 text-sm text-gray-500">
                      {t('security.webhooks.inbound.deliveryLog.help')}
                    </p>
                  </div>
                  <div className="text-xs text-gray-500">
                    {inboundDeliveryPage
                      ? t('security.webhooks.inbound.deliveryLog.pageSummary', {
                        page: inboundDeliveryPage.page,
                        total: Math.max(1, Math.ceil(inboundDeliveryPage.total / inboundDeliveryPage.limit)),
                      })
                      : null}
                  </div>
                </div>
                <div className="mb-3 max-w-xs">
                  <CustomSelect
                    id="inbound-webhook-delivery-status-filter"
                    label={t('security.webhooks.inbound.deliveryLog.columns.status')}
                    value={inboundDeliveryStatusFilter}
                    onValueChange={(value) => {
                      setInboundDeliveryStatusFilter(value as InboundWebhookDispatchStatus | 'all');
                      setInboundDeliveryPageNumber(1);
                    }}
                    options={inboundDeliveryStatusOptions}
                  />
                </div>
                {inboundDeliveryPage && inboundDeliveryPage.data.length > 0 ? (
                  <DataTable<InboundWebhookDelivery>
                    id="inbound-webhook-deliveries-table"
                    data={inboundDeliveryPage.data}
                    columns={inboundDeliveryColumns}
                    pagination
                    currentPage={inboundDeliveryPageNumber}
                    onPageChange={setInboundDeliveryPageNumber}
                    pageSize={inboundDeliveryPage.limit}
                  />
                ) : (
                  <div className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">
                    {t('security.webhooks.inbound.deliveryLog.empty')}
                  </div>
                )}
              </div>
            ) : null}
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
            onClick={() => void handleSaveInboundWebhook()}
          >
            {t(
              identityForm.inboundWebhookId
                ? 'security.webhooks.inbound.dialog.save'
                : 'security.webhooks.inbound.dialog.create',
            )}
          </Button>
        </DialogFooter>
      </Dialog>

      <Drawer
        id="inbound-webhook-delivery-detail"
        isOpen={selectedInboundDelivery !== null}
        onClose={() => setSelectedInboundDelivery(null)}
        hideCloseButton
        width="min(720px, 100vw)"
      >
        {selectedInboundDelivery ? (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {t('security.webhooks.inbound.deliveryDetail.title')}
                </h3>
                <p className="mt-1 break-all text-sm text-gray-500">
                  {selectedInboundDelivery.deliveryId}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  id="inbound-webhook-delivery-detail-replay"
                  variant="outline"
                  onClick={() => void handleReplayInboundDelivery(selectedInboundDelivery.deliveryId)}
                >
                  {t('security.webhooks.inbound.deliveryDetail.replay')}
                </Button>
                <Button
                  id="inbound-webhook-delivery-detail-close"
                  variant="ghost"
                  onClick={() => setSelectedInboundDelivery(null)}
                >
                  {t('security.webhooks.inbound.deliveryDetail.close')}
                </Button>
              </div>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-gray-500">{t('security.webhooks.inbound.deliveryDetail.received')}</dt>
                <dd className="text-sm text-gray-900">{formatDateTime(selectedInboundDelivery.receivedAt as string, neverLabel)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500">{t('security.webhooks.inbound.deliveryDetail.status')}</dt>
                <dd className="mt-1">
                  <Badge
                    variant={getInboundDeliveryStatusBadgeVariant(selectedInboundDelivery.dispatchStatus)}
                    size="sm"
                  >
                    {t(`security.webhooks.inbound.deliveryLog.status.${selectedInboundDelivery.dispatchStatus}`, {
                      defaultValue: selectedInboundDelivery.dispatchStatus,
                    })}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500">{t('security.webhooks.inbound.deliveryDetail.responseStatus')}</dt>
                <dd className="text-sm text-gray-900">{selectedInboundDelivery.responseStatus ?? t('security.webhooks.deliveries.noResponseCode')}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500">{t('security.webhooks.inbound.deliveryDetail.duration')}</dt>
                <dd className="text-sm text-gray-900">
                  {selectedInboundDelivery.durationMs == null
                    ? t('security.webhooks.deliveries.noResponseCode')
                    : t('security.webhooks.inbound.deliveryLog.durationMs', { duration: selectedInboundDelivery.durationMs })}
                </dd>
              </div>
            </dl>
            {selectedInboundDelivery.handlerOutcome?.error ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                {String(selectedInboundDelivery.handlerOutcome.error)}
              </div>
            ) : null}
            {[
              ['headers', selectedInboundDelivery.requestHeaders],
              ['requestBody', selectedInboundDelivery.requestBody],
              ['responseBody', selectedInboundDelivery.responseBody],
              ['handlerOutcome', selectedInboundDelivery.handlerOutcome],
            ].map(([key, value]) => (
              <div key={key as string}>
                <h4 className="mb-2 text-sm font-medium text-gray-900">
                  {t(`security.webhooks.inbound.deliveryDetail.sections.${key as string}`)}
                </h4>
                <pre className="max-h-80 overflow-auto rounded-md bg-gray-950 p-3 text-xs text-gray-100">
                  {formatJsonForDisplay(value)}
                </pre>
              </div>
            ))}
          </div>
        ) : null}
      </Drawer>

      <Dialog
        id="inbound-webhook-test"
        isOpen={testDialogOpen}
        onClose={() => setTestDialogOpen(false)}
        title={t('security.webhooks.inbound.test.title')}
      >
        <DialogContent>
          <div className="space-y-4">
            <TextArea
              id="inbound-webhook-test-body"
              label={t('security.webhooks.inbound.test.body')}
              value={testBodyText}
              onChange={(event) => setTestBodyText(event.target.value)}
              className="font-mono text-sm"
            />
            <TextArea
              id="inbound-webhook-test-headers"
              label={t('security.webhooks.inbound.test.headers')}
              value={testHeadersText}
              onChange={(event) => setTestHeadersText(event.target.value)}
              className="font-mono text-sm"
            />
          </div>
        </DialogContent>
        <DialogFooter>
          <Button
            id="inbound-webhook-test-cancel"
            variant="ghost"
            onClick={() => setTestDialogOpen(false)}
          >
            {t('security.webhooks.inbound.test.cancel')}
          </Button>
          <Button
            id="inbound-webhook-test-send"
            onClick={() => void handleSendInboundTest()}
          >
            {t('security.webhooks.inbound.test.send')}
          </Button>
        </DialogFooter>
      </Dialog>

      <ConfirmationDialog
        id="inbound-webhook-replay-confirm"
        isOpen={replayConfirmDeliveryId !== null}
        onClose={() => {
          if (!isReplayInFlight) {
            setReplayConfirmDeliveryId(null);
          }
        }}
        onConfirm={handleConfirmReplay}
        title={t('security.webhooks.inbound.deliveryDetail.replay')}
        message={t('security.webhooks.inbound.deliveryDetail.replayConfirm')}
        confirmLabel={t('security.webhooks.inbound.deliveryDetail.replay')}
        cancelLabel={t('security.webhooks.inbound.dialog.cancel')}
        isConfirming={isReplayInFlight}
      />
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
  // LEVERAGE: friction datatable-client-paging — re-derives page/size state + reset handler DataTable already owns internally
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
