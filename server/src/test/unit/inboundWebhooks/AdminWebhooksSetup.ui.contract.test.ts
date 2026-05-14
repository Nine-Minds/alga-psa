import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const adminWebhooksSource = readFileSync(
  path.resolve(process.cwd(), 'src/components/settings/security/AdminWebhooksSetup.tsx'),
  'utf8',
);

const inboundWebhooksSource = adminWebhooksSource.slice(
  adminWebhooksSource.indexOf('function InboundWebhooksListView()'),
  adminWebhooksSource.indexOf('function OutboundWebhooksSetup()'),
);

describe('AdminWebhooksSetup inbound UI contract', () => {
  it('T130: renders a tabbed webhooks settings shell with inbound and outbound tabs', () => {
    expect(adminWebhooksSource).toContain('<ViewSwitcher');
    expect(adminWebhooksSource).toContain("id: 'webhooks-inbound-view-btn'");
    expect(adminWebhooksSource).toContain("id: 'webhooks-outbound-view-btn'");
    expect(adminWebhooksSource).toContain("activeTab === 'inbound'");
    expect(adminWebhooksSource).toContain('<InboundWebhooksListView />');
    expect(adminWebhooksSource).toContain('<OutboundWebhooksSetup />');
  });

  it('T131: keeps the outbound webhook setup wired to the existing outbound actions', () => {
    expect(adminWebhooksSource).toContain('<OutboundWebhooksSetup />');
    expect(adminWebhooksSource).toContain('function OutboundWebhooksSetup()');

    for (const actionName of [
      'listWebhooks',
      'upsertWebhook',
      'deleteWebhook',
      'sendWebhookTest',
      'rotateWebhookSecret',
      'setWebhookActiveState',
      'retryWebhookDelivery',
      'listWebhookDeliveries',
      'listWebhookEvents',
      'getWebhookStatsSnapshot',
    ]) {
      expect(adminWebhooksSource).toContain(actionName);
    }
  });

  it('T132: renders the inbound list table with name, URL, handler, last delivery, and active columns', () => {
    expect(adminWebhooksSource).toContain('function InboundWebhooksListView()');
    expect(adminWebhooksSource).toContain('const columns = useMemo<ColumnDefinition<InboundWebhookConfig>[]>');
    expect(adminWebhooksSource).toContain("title: t('security.webhooks.inbound.list.columns.name')");
    expect(adminWebhooksSource).toContain('buildInboundWebhookUrl(webhook)');
    expect(adminWebhooksSource).toContain("title: t('security.webhooks.inbound.list.columns.handler')");
    expect(adminWebhooksSource).toContain("title: t('security.webhooks.inbound.list.columns.lastDelivery')");
    expect(adminWebhooksSource).toContain("title: t('security.webhooks.inbound.list.columns.active')");
    expect(adminWebhooksSource).toContain('<DataTable');
    expect(adminWebhooksSource).toContain('data={webhooks}');
    expect(adminWebhooksSource).toContain('columns={columns}');
  });

  it('T133: inbound create/edit dialog includes identity fields for name, slug, and description', () => {
    expect(adminWebhooksSource).toContain('id="inbound-webhook-identity"');
    expect(adminWebhooksSource).toContain("t('security.webhooks.inbound.identity.title')");
    expect(adminWebhooksSource).toContain('id="inbound-webhook-name"');
    expect(adminWebhooksSource).toContain("label={t('security.webhooks.inbound.identity.name')}");
    expect(adminWebhooksSource).toContain('id="inbound-webhook-slug"');
    expect(adminWebhooksSource).toContain("label={t('security.webhooks.inbound.identity.slug')}");
    expect(adminWebhooksSource).toContain('slugifyInboundWebhookName(event.target.value)');
    expect(adminWebhooksSource).toContain('id="inbound-webhook-description"');
    expect(adminWebhooksSource).toContain("label={t('security.webhooks.inbound.identity.description')}");
  });

  it('T134: auth section conditionally renders HMAC signature-header fields', () => {
    expect(adminWebhooksSource).toContain("value: 'hmac_sha256'");
    expect(adminWebhooksSource).toContain("label: t('security.webhooks.inbound.auth.types.hmacSha256')");
    expect(adminWebhooksSource).toContain('id="inbound-webhook-auth-type"');
    expect(adminWebhooksSource).toContain("identityForm.authType === 'hmac_sha256'");
    expect(adminWebhooksSource).toContain('id="inbound-webhook-auth-hmac-header"');
    expect(adminWebhooksSource).toContain("label={t('security.webhooks.inbound.auth.signatureHeader')}");
    expect(adminWebhooksSource).toContain('hmacSignatureHeader: event.target.value');
  });

  it('T135: auth section conditionally renders Bearer token fields', () => {
    expect(adminWebhooksSource).toContain("value: 'bearer'");
    expect(adminWebhooksSource).toContain("label: t('security.webhooks.inbound.auth.types.bearer')");
    expect(adminWebhooksSource).toContain("identityForm.authType === 'bearer'");
    expect(adminWebhooksSource).toContain('id="inbound-webhook-auth-bearer-token"');
    expect(adminWebhooksSource).toContain("label={t('security.webhooks.inbound.auth.bearerToken')}");
    expect(adminWebhooksSource).toContain('type="password"');
    expect(adminWebhooksSource).toContain("t('security.webhooks.inbound.auth.secretUnchangedPlaceholder')");
    expect(adminWebhooksSource).toContain('bearerToken: event.target.value');
  });

  it('T136: auth section conditionally renders IP allowlist fields', () => {
    expect(adminWebhooksSource).toContain("value: 'ip_allowlist'");
    expect(adminWebhooksSource).toContain("label: t('security.webhooks.inbound.auth.types.ipAllowlist')");
    expect(adminWebhooksSource).toContain("identityForm.authType === 'ip_allowlist'");
    expect(adminWebhooksSource).toContain('id="inbound-webhook-auth-ip-cidrs"');
    expect(adminWebhooksSource).toContain("label={t('security.webhooks.inbound.auth.ipCidrs')}");
    expect(adminWebhooksSource).toContain("placeholder={t('security.webhooks.inbound.auth.ipCidrsPlaceholder')}");
    expect(adminWebhooksSource).toContain('ipCidrs: event.target.value');
  });

  it('T137: displays a created inbound webhook secret once and clears it when closed', () => {
    expect(adminWebhooksSource).toContain('upsertInboundWebhook');
    expect(adminWebhooksSource).toContain('setRevealedInboundSecret({');
    expect(adminWebhooksSource).toContain('webhookName: result.webhook.name');
    expect(adminWebhooksSource).toContain('secret: result.secret');
    expect(adminWebhooksSource).toContain('id="inbound-webhook-secret"');
    expect(adminWebhooksSource).toContain('isOpen={revealedInboundSecret !== null}');
    expect(adminWebhooksSource).toContain("onClose={() => setRevealedInboundSecret(null)}");
    expect(adminWebhooksSource).toContain("{revealedInboundSecret?.secret ?? ''}");
    expect(adminWebhooksSource).toContain('id="inbound-webhook-secret-close"');
  });

  it('T138: rotate secret flow displays the new inbound secret once', () => {
    expect(adminWebhooksSource).toContain('rotateInboundWebhookSecret');
    expect(adminWebhooksSource).toContain('const handleRotateInboundSecret = useCallback');
    expect(adminWebhooksSource).toContain("identityForm.authType === 'ip_allowlist'");
    expect(adminWebhooksSource).toContain('id="inbound-webhook-auth-rotate-secret"');
    expect(adminWebhooksSource).toContain('onClick={() => void handleRotateInboundSecret()}');
    expect(adminWebhooksSource).toContain('secret: result.secret');
    expect(adminWebhooksSource).toContain('isOpen={revealedInboundSecret !== null}');
  });

  it('T139: idempotency section renders source dropdown, value input, and duplicate window', () => {
    expect(adminWebhooksSource).toContain('id="inbound-webhook-idempotency-type"');
    expect(adminWebhooksSource).toContain("label={t('security.webhooks.inbound.idempotency.source')}");
    expect(adminWebhooksSource).toContain("value: 'header'");
    expect(adminWebhooksSource).toContain("value: 'jsonata'");
    expect(adminWebhooksSource).toContain('id="inbound-webhook-idempotency-value"');
    expect(adminWebhooksSource).toContain("security.webhooks.inbound.idempotency.headerName");
    expect(adminWebhooksSource).toContain("security.webhooks.inbound.idempotency.jsonataExpression");
    expect(adminWebhooksSource).toContain('id="inbound-webhook-idempotency-window"');
    expect(adminWebhooksSource).toContain('idempotencyWindowSeconds: Number(event.target.value)');
  });

  it('T140: handler section switches between direct-action and workflow views', () => {
    expect(adminWebhooksSource).toContain('id="inbound-webhook-handler-type"');
    expect(adminWebhooksSource).toContain("value: 'direct_action'");
    expect(adminWebhooksSource).toContain("value: 'workflow'");
    expect(adminWebhooksSource).toContain("const nextType = value as InboundWebhookConfig['handlerType']");
    expect(adminWebhooksSource).toContain('inboundWebhookWorkflowHandlersEnabled');
    expect(adminWebhooksSource).toContain('handlerType: nextType');
    expect(adminWebhooksSource).toContain("identityForm.handlerType === 'direct_action'");
    expect(adminWebhooksSource).toContain("t('security.webhooks.inbound.handler.directActionTitle')");
    expect(adminWebhooksSource).toContain("t('security.webhooks.inbound.handler.workflowTitle')");
  });

  it('gates workflow consumers to Enterprise edition using the shared edition flag', () => {
    expect(adminWebhooksSource).toContain("import { isEnterprise } from '@alga-psa/core/features'");
    expect(adminWebhooksSource).toContain('const inboundWebhookWorkflowHandlersEnabled = isEnterprise');
    expect(adminWebhooksSource).toContain("nextType === 'workflow' && !inboundWebhookWorkflowHandlersEnabled");
    expect(adminWebhooksSource).toContain('inboundWebhookWorkflowHandlersEnabled ? listInboundWorkflowOptions() : Promise.resolve([])');
    expect(inboundWebhooksSource).not.toContain('ee/server');
  });

  it('T141: action dropdown lists registered inbound actions', () => {
    expect(adminWebhooksSource).toContain('listInboundWebhookActions');
    expect(adminWebhooksSource).toContain('const [inboundActions, setInboundActions]');
    expect(adminWebhooksSource).toContain('setInboundActions(actionDefinitions)');
    expect(adminWebhooksSource).toContain('const inboundActionOptions = useMemo(() => inboundActions.map((action) => ({');
    expect(adminWebhooksSource).toContain('value: action.name');
    expect(adminWebhooksSource).toContain('label: `${action.entityType}: ${action.displayName}`');
    expect(adminWebhooksSource).toContain('id="inbound-webhook-direct-action"');
    expect(adminWebhooksSource).toContain('options={inboundActionOptions}');
  });

  it('T142: selected action renders target fields with expression mapping rows', () => {
    expect(adminWebhooksSource).toContain('const selectedInboundAction = useMemo');
    expect(adminWebhooksSource).toContain('inboundActions.find((action) => action.name === identityForm.directActionName)');
    expect(adminWebhooksSource).toContain('selectedInboundAction.targetFields.map((field) => {');
    expect(adminWebhooksSource).toContain('htmlFor={`inbound-webhook-mapping-${field.name}`}');
    expect(adminWebhooksSource).toContain('<InboundWebhookMappingFieldRow');
    expect(adminWebhooksSource).toContain('samplePayload={identityForm.samplePayload}');
    expect(adminWebhooksSource).toContain('[field.name]: value');
  });

  it("T143: workflow dropdown lists the tenant's workflows", () => {
    expect(adminWebhooksSource).toContain('listInboundWorkflowOptions');
    expect(adminWebhooksSource).toContain('const [workflowOptions, setWorkflowOptions]');
    expect(adminWebhooksSource).toContain('setWorkflowOptions(workflows)');
    expect(adminWebhooksSource).toContain('const workflowSelectOptions = useMemo(() => workflowOptions.map((workflow) => ({');
    expect(adminWebhooksSource).toContain('value: workflow.workflowId');
    expect(adminWebhooksSource).toContain('label: workflow.name');
    expect(adminWebhooksSource).toContain('id="inbound-webhook-workflow"');
    expect(adminWebhooksSource).toContain('options={workflowSelectOptions}');
  });

  it('T144: workflow envelope info card displays the documented shape', () => {
    expect(adminWebhooksSource).toContain("t('security.webhooks.inbound.handler.envelopeTitle')");
    for (const field of [
      '"source": "<webhook_slug>"',
      '"body": { }',
      '"headers": { }',
      '"verified": true',
      '"delivery_id": "<delivery_id>"',
      '"idempotency_key": "<key>"',
      '"received_at": "<iso_timestamp>"',
    ]) {
      expect(adminWebhooksSource).toContain(field);
    }
  });

  it('T145: sample capture button toggles capture mode and shows active window status', () => {
    expect(adminWebhooksSource).toContain('captureSamplePayload');
    expect(adminWebhooksSource).toContain('const sampleCaptureActive = identityForm.sampleCaptureExpiresAt');
    expect(adminWebhooksSource).toContain('new Date(identityForm.sampleCaptureExpiresAt).getTime() > now');
    expect(adminWebhooksSource).toContain('const handleCaptureSample = useCallback');
    expect(adminWebhooksSource).toContain('captureSamplePayload(identityForm.inboundWebhookId)');
    expect(adminWebhooksSource).toContain('sampleCaptureExpiresAt: updated.sampleCaptureExpiresAt');
    expect(adminWebhooksSource).toContain('id="inbound-webhook-capture-sample"');
    expect(adminWebhooksSource).toContain('disabled={!identityForm.inboundWebhookId}');
    expect(adminWebhooksSource).toContain("t('security.webhooks.inbound.sample.captureActive'");
  });

  it('T146: sample tree side panel renders captured payload paths', () => {
    expect(adminWebhooksSource).toContain('buildWebhookPayloadExpressionPathOptions');
    expect(adminWebhooksSource).toContain('const samplePathOptions = useMemo');
    expect(adminWebhooksSource).toContain('buildWebhookPayloadExpressionPathOptions(identityForm.samplePayload');
    expect(adminWebhooksSource).toContain("t('security.webhooks.inbound.sampleTree.title')");
    expect(adminWebhooksSource).toContain('samplePathOptions.length === 0');
    expect(adminWebhooksSource).toContain('samplePathOptions.map((option) => (');
    expect(adminWebhooksSource).toContain('id={`inbound-webhook-sample-path-${option.path.replace(/[^a-zA-Z0-9_-]+/g, \'-\')}`}');
    expect(adminWebhooksSource).toContain('{option.path}');
  });

  it('T147: clicking a sample path inserts it into the focused expression field', () => {
    expect(adminWebhooksSource).toContain('const [focusedMappingField, setFocusedMappingField]');
    expect(adminWebhooksSource).toContain('const handleInsertSamplePath = useCallback((path: string) => {');
    expect(adminWebhooksSource).toContain('if (!focusedMappingField) {');
    expect(adminWebhooksSource).toContain('[focusedMappingField]: path');
    expect(adminWebhooksSource).toContain('onFocusExpression={(fieldName) => setFocusedMappingField(fieldName)}');
    expect(adminWebhooksSource).toContain('disabled={!focusedMappingField}');
    expect(adminWebhooksSource).toContain('onClick={() => handleInsertSamplePath(option.path)}');
  });

  it('T148: active toggle persists state for saved inbound webhooks', () => {
    expect(adminWebhooksSource).toContain('setInboundWebhookActiveState');
    expect(adminWebhooksSource).toContain('const handleInboundActiveChange = useCallback(async (checked: boolean) => {');
    expect(adminWebhooksSource).toContain('setInboundWebhookActiveState(identityForm.inboundWebhookId, checked)');
    expect(adminWebhooksSource).toContain('isActive: updated.isActive');
    expect(adminWebhooksSource).toContain('autoDisabledAt: updated.autoDisabledAt');
    expect(adminWebhooksSource).toContain('id="inbound-webhook-active"');
    expect(adminWebhooksSource).toContain('checked={identityForm.isActive}');
    expect(adminWebhooksSource).toContain('onCheckedChange={(checked) => void handleInboundActiveChange(checked)}');
  });

  it('T149: auto-disable banner shows when autoDisabledAt is set', () => {
    expect(adminWebhooksSource).toContain('autoDisabledAt: updated.autoDisabledAt');
    expect(adminWebhooksSource).toContain('{identityForm.autoDisabledAt ? (');
    expect(adminWebhooksSource).toContain("t('security.webhooks.inbound.active.autoDisabled'");
    expect(adminWebhooksSource).toContain('date: formatDateTime(identityForm.autoDisabledAt as string, neverLabel)');
    expect(adminWebhooksSource).toContain('border-amber-200 bg-amber-50');
  });

  it('T160: delivery log paginates and filters by webhook plus dispatch status', () => {
    expect(adminWebhooksSource).toContain('const [inboundDeliveryStatusFilter, setInboundDeliveryStatusFilter]');
    expect(adminWebhooksSource).toContain('const loadInboundDialogDeliveries = useCallback(async (');
    expect(adminWebhooksSource).toContain('inboundWebhookId: webhookId');
    expect(adminWebhooksSource).toContain("status: status === 'all' ? undefined : status");
    expect(adminWebhooksSource).toContain('id="inbound-webhook-delivery-status-filter"');
    expect(adminWebhooksSource).toContain('options={inboundDeliveryStatusOptions}');
    expect(adminWebhooksSource).toContain('id="inbound-webhook-deliveries-table"');
    expect(adminWebhooksSource).toContain('pagination');
    expect(adminWebhooksSource).toContain('onPageChange={setInboundDeliveryPageNumber}');
  });

  it('renders inbound delivery dispatch statuses with badge variants', () => {
    expect(adminWebhooksSource).toContain("import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge'");
    expect(adminWebhooksSource).toContain('function getInboundDeliveryStatusBadgeVariant(status: InboundWebhookDispatchStatus): BadgeVariant');
    expect(adminWebhooksSource).toContain("status === 'dispatched'");
    expect(adminWebhooksSource).toContain("return 'success'");
    expect(adminWebhooksSource).toContain("status === 'failed'");
    expect(adminWebhooksSource).toContain("return 'error'");
    expect(adminWebhooksSource).toContain('<Badge');
    expect(adminWebhooksSource).toContain('variant={getInboundDeliveryStatusBadgeVariant(value as InboundWebhookDispatchStatus)}');
    expect(adminWebhooksSource).toContain('variant={getInboundDeliveryStatusBadgeVariant(selectedInboundDelivery.dispatchStatus)}');
  });

  it('T161: delivery detail drawer shows request, response, latency, and errors', () => {
    expect(adminWebhooksSource).toContain('id="inbound-webhook-delivery-detail"');
    expect(adminWebhooksSource).toContain('isOpen={selectedInboundDelivery !== null}');
    expect(adminWebhooksSource).toContain('selectedInboundDelivery.responseStatus');
    expect(adminWebhooksSource).toContain('selectedInboundDelivery.durationMs');
    expect(adminWebhooksSource).toContain('selectedInboundDelivery.handlerOutcome?.error');
    expect(adminWebhooksSource).toContain("['headers', selectedInboundDelivery.requestHeaders]");
    expect(adminWebhooksSource).toContain("['requestBody', selectedInboundDelivery.requestBody]");
    expect(adminWebhooksSource).toContain("['responseBody', selectedInboundDelivery.responseBody]");
    expect(adminWebhooksSource).toContain('formatJsonForDisplay(value)');
  });

  it('T165: synthetic test dialog accepts custom body and headers for in-process dispatch', () => {
    expect(adminWebhooksSource).toContain('sendInboundWebhookTest');
    expect(adminWebhooksSource).toContain('const [testBodyText, setTestBodyText]');
    expect(adminWebhooksSource).toContain('const [testHeadersText, setTestHeadersText]');
    expect(adminWebhooksSource).toContain('const handleSendInboundTest = useCallback(async () => {');
    expect(adminWebhooksSource).toContain('const body = testBodyText.trim() ? JSON.parse(testBodyText) : {};');
    expect(adminWebhooksSource).toContain('parseCustomHeaders(');
    expect(adminWebhooksSource).toContain('sendInboundWebhookTest(identityForm.inboundWebhookId, { body, headers })');
    expect(adminWebhooksSource).toContain('id="inbound-webhook-test-body"');
    expect(adminWebhooksSource).toContain('id="inbound-webhook-test-headers"');
    expect(adminWebhooksSource).toContain('id="inbound-webhook-test-send"');
  });

  it('T170: inbound UI avoids hardcoded English copy outside translation calls', () => {
    expect(inboundWebhooksSource).toContain("useTranslation('msp/profile')");
    expect(inboundWebhooksSource).toContain("t('security.webhooks.inbound.");

    const jsxTextLiterals = Array.from(inboundWebhooksSource.matchAll(/>\s*([A-Z][A-Za-z][A-Za-z ]{2,})\s*</g))
      .map((match) => match[1]);

    expect(jsxTextLiterals).toEqual([]);
  });

  it('T171: inbound interactive elements use kebab-case id attributes', () => {
    const staticInboundIds = Array.from(inboundWebhooksSource.matchAll(/id="(inbound-[^"]+)"/g))
      .map((match) => match[1]);

    expect(staticInboundIds.length).toBeGreaterThan(20);
    for (const id of staticInboundIds) {
      expect(id).toMatch(/^inbound-[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }

    expect(inboundWebhooksSource).toContain('id={`inbound-webhook-sample-path-${option.path.replace(/[^a-zA-Z0-9_-]+/g, \'-\')}`}');
    expect(inboundWebhooksSource).toContain('id={`inbound-webhook-delivery-view-${delivery.deliveryId}`}');
  });

  it('T180: renders the Settings inbound tab without a rollout feature flag', () => {
    expect(adminWebhooksSource).not.toContain('useFeatureFlag(');
    expect(adminWebhooksSource).toContain("useState<'inbound' | 'outbound'>('outbound')");
    expect(adminWebhooksSource).toContain('<ViewSwitcher');
    expect(adminWebhooksSource).toContain("activeTab === 'inbound'");
    expect(adminWebhooksSource).toContain('<InboundWebhooksListView />');
    expect(adminWebhooksSource).toContain("id: 'webhooks-inbound-view-btn'");
  });
});
