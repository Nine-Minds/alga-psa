import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const adminWebhooksSource = readFileSync(
  path.resolve(process.cwd(), 'src/components/settings/security/AdminWebhooksSetup.tsx'),
  'utf8',
);

describe('AdminWebhooksSetup inbound UI contract', () => {
  it('T130: renders a tabbed webhooks settings shell with inbound and outbound tabs', () => {
    expect(adminWebhooksSource).toContain('<Tabs value={activeTab}');
    expect(adminWebhooksSource).toContain('<TabsList className="mb-6">');
    expect(adminWebhooksSource).toContain('<TabsTrigger id="webhooks-inbound-tab" value="inbound">');
    expect(adminWebhooksSource).toContain('<TabsTrigger id="webhooks-outbound-tab" value="outbound">');
    expect(adminWebhooksSource).toContain('<TabsContent value="inbound">');
    expect(adminWebhooksSource).toContain('<TabsContent value="outbound">');
    expect(adminWebhooksSource).toContain('<InboundWebhooksListView />');
    expect(adminWebhooksSource).toContain('<OutboundWebhooksSetup />');
  });

  it('T131: keeps the outbound webhook setup wired to the existing outbound actions', () => {
    expect(adminWebhooksSource).toContain('<TabsContent value="outbound">');
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
});
