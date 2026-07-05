import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The webhook routes are re-export stubs; the query logic lives in the
// packages/integrations handlers, which reach email_providers through the
// tenantDb facade (tenant-scoped table()/tenantJoin(), or a reasoned
// .unscoped() escape hatch for tenant discovery).
describe('Citus safety: tenant-scoped email provider reads on distributed tables', () => {
  it('scopes email_providers lookups by tenant in Microsoft webhook handler', () => {
    const filePath = path.resolve(
      __dirname,
      '../../../../packages/integrations/src/webhooks/email/handlers/microsoftWebhookHandler.ts'
    );
    const source = fs.readFileSync(filePath, 'utf-8');

    // Tenant discovery from the vendor config is an explicit, reasoned escape hatch...
    expect(source).toContain(
      "discoveryDb.unscoped(\n            'microsoft_email_provider_config as mc',\n            'tenant discovery from Microsoft email webhook subscription'\n          )"
    );
    // ...and the join to email_providers stays tenant-scoped through the facade.
    expect(source).toContain(
      "discoveryDb.tenantJoin(providerQuery, 'email_providers as ep', 'mc.email_provider_id', 'ep.id', {"
    );
    expect(source).toContain("rootTenantColumn: 'mc.tenant',");
  });

  it('scopes email_providers lookups by tenant in Google webhook handler', () => {
    const filePath = path.resolve(
      __dirname,
      '../../../../packages/integrations/src/webhooks/email/handlers/googleWebhookHandler.ts'
    );
    const source = fs.readFileSync(filePath, 'utf-8');

    // Subscription-mapped provider load is tenant-scoped through the facade.
    expect(source).toContain('provider = await tenantDb(knex, cfg.tenant)');
    expect(source).toContain(".table('email_providers')");
    expect(source).toContain(".where('id', cfg.email_provider_id)");
    // The mailbox fallback is a reasoned tenant-discovery escape hatch.
    expect(source).toContain(
      ".unscoped('email_providers', 'tenant discovery from Google email webhook mailbox')"
    );
    // Google config is loaded under the discovered tenant.
    expect(source).toContain('googleConfig = await tenantDb(knex, provider.tenant)');
    expect(source).toContain(".table('google_email_provider_config')");
  });
});
