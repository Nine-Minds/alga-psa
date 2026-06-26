import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../../../../..');

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

function expectNoDirectRoots(source: string, tables: string[]): void {
  const tablePattern = tables.join('|');
  expect(source).not.toMatch(new RegExp(`\\b(?:knex|trx|db|deps\\.knex|this\\.knex)\\s*(?:<[^>]+>)?\\(\\s*['"](?:${tablePattern})['"]\\s*\\)`));
}

describe('EE integrations wave 2 tenant facade contract', () => {
  it('routes Level.io action and sync RMM roots through tenantDb', () => {
    const actions = read('ee/server/src/lib/actions/integrations/levelIoActions.ts');
    const sync = read('ee/server/src/lib/integrations/levelio/sync/syncEngine.ts');
    const combined = `${actions}\n${sync}`;

    expect(actions).toContain("import { tenantDb } from '@alga-psa/db';");
    expect(sync).toContain("import { tenantDb } from '@alga-psa/db';");
    expect(actions).toContain("db.tenantJoin(rowsQuery, 'clients as c'");
    expect(sync).toContain("tenantDb(knex, tenant).table('rmm_integrations')");
    expect(sync).toContain("db.table('tenant_external_entity_mappings')");
    expectNoDirectRoots(combined, [
      'assets',
      'clients',
      'rmm_alerts',
      'rmm_integrations',
      'rmm_organization_mappings',
      'tenant_external_entity_mappings',
    ]);
    expect(combined).not.toMatch(/\.where\(\{\s*tenant/);
  });

  it('routes Huntress action, sync, poll, incident, and ticket roots through tenantDb', () => {
    const files = [
      'ee/server/src/lib/actions/integrations/huntressActions.ts',
      'ee/server/src/lib/integrations/huntress/huntressClient.ts',
      'ee/server/src/lib/integrations/huntress/organizations/orgSync.ts',
      'ee/server/src/lib/integrations/huntress/incidents/incidentPoller.ts',
      'ee/server/src/lib/integrations/huntress/incidents/incidentProcessor.ts',
      'ee/server/src/lib/integrations/huntress/incidents/ticketCreator.ts',
    ];
    const combined = files.map(read).join('\n');

    for (const file of files) {
      expect(read(file), file).toContain('tenantDb');
    }
    expect(combined).toContain("db.tenantJoin(mappingsQuery, 'rmm_integrations as ri'");
    expect(combined).toContain("db.tenantJoin(mappingsQuery, 'clients as c'");
    expectNoDirectRoots(combined, [
      'assets',
      'asset_associations',
      'boards',
      'categories',
      'clients',
      'comment_threads',
      'comments',
      'priorities',
      'rmm_alerts',
      'rmm_integrations',
      'rmm_organization_mappings',
      'statuses',
      'tenant_external_entity_mappings',
      'tickets',
      'users',
    ]);
    expect(combined).not.toMatch(/\.where\(\{\s*tenant/);
  });

  it('routes Temporal tenant setup and user tenant rows through tenantDb while preserving cross-tenant guards', () => {
    const tenantOps = read('ee/temporal-workflows/src/db/tenant-operations.ts');
    const userOps = read('ee/temporal-workflows/src/db/user-operations.ts');
    const combined = `${tenantOps}\n${userOps}`;

    expect(combined).toContain("import { tenantDb } from '@alga-psa/db';");
    expect(userOps).toContain("const existingInternalUser = await trx('users')");
    expect(tenantOps).toContain("const existing = await knex('stripe_subscriptions')");
    expect(tenantOps).toContain("const tenantResult = await trx('tenants')");
    expect(tenantOps).toContain("tenantDb(trx, input.tenantId).table('stripe_subscriptions')");
    expect(tenantOps).toContain("db.table('tenant_email_settings')");
    expect(userOps).toContain("const db = tenantDb(trx, input.tenantId);");
    expect(userOps).toContain("await db.table('user_roles')");
    expectNoDirectRoots(combined, [
      'apple_iap_subscriptions',
      'client_locations',
      'clients',
      'mobile_push_tokens',
      'roles',
      'stripe_customers',
      'stripe_prices',
      'stripe_products',
      'tenant_addons',
      'tenant_companies',
      'tenant_email_settings',
      'tenant_internal_notification_category_settings',
      'tenant_internal_notification_subtype_settings',
      'tenant_notification_category_settings',
      'tenant_notification_subtype_settings',
      'tenant_settings',
      'user_roles',
    ]);
  });

  it('routes Teams package, availability, notification, meeting, and PSA data roots through tenantDb', () => {
    const files = [
      'packages/integrations/src/actions/integrations/teamsActions.ts',
      'packages/integrations/src/actions/integrations/teamsPackageActions.ts',
      'packages/integrations/src/lib/teamsAvailability.ts',
      'ee/packages/microsoft-teams/src/lib/actions/integrations/teamsActions.ts',
      'ee/packages/microsoft-teams/src/lib/actions/integrations/teamsPackageActions.ts',
      'ee/packages/microsoft-teams/src/lib/actions/integrations/teamsDiagnosticsActions.ts',
      'ee/packages/microsoft-teams/src/lib/actions/meetings/meetingCapabilityActions.ts',
      'ee/packages/microsoft-teams/src/lib/auth/teamsMicrosoftProviderResolution.ts',
      'ee/packages/microsoft-teams/src/lib/meetings/artifactSubscriptions.ts',
      'ee/packages/microsoft-teams/src/lib/meetings/meetingConfig.ts',
      'ee/packages/microsoft-teams/src/lib/notifications/teamsNotificationDelivery.ts',
      'ee/packages/microsoft-teams/src/lib/teams/teamsAvailability.ts',
      'ee/packages/microsoft-teams/src/lib/teams/teamsPsaData.ts',
    ];
    const combined = files.map(read).join('\n');

    for (const file of files) {
      expect(read(file), file).toContain('tenantDb');
    }
    expect(combined).toContain("db.tenantJoin(query, 'clients as comp'");
    expect(combined).toContain("db.subquery('contact_phone_numbers as cpn')");
    expect(combined).toContain("db.tenantJoin(managerScope, 'teams'");
    expectNoDirectRoots(combined, [
      'asset_associations',
      'clients',
      'comment_threads',
      'comments',
      'contact_phone_numbers',
      'contacts',
      'interaction_types',
      'microsoft_profiles',
      'priorities',
      'project_tasks',
      'statuses',
      'team_members',
      'teams',
      'teams_integrations',
      'tenant_addons',
      'tickets',
      'time_entries',
      'time_periods',
      'time_sheet_comments',
      'time_sheets',
      'users',
    ]);
  });

  it('routes extension host API and PaymentService registered roots through tenantDb', () => {
    const scheduler = read('ee/server/src/lib/extensions/schedulerHostApi.ts');
    const invoicing = read('ee/server/src/lib/extensions/invoicingHostApi.ts');
    const payments = read('ee/server/src/lib/payments/PaymentService.ts');

    expect(scheduler).toContain("db.table('tenant_extension_schedule as s')");
    expect(scheduler).toContain("txDb.table('tenant_extension_install')");
    expect(invoicing).toContain("tenantDb(trx, tenantId).table<{ user_id: string }>('users')");
    expect(invoicing).toContain("db.table('invoices')");
    expect(payments).toContain('private tenantTable<Row extends object>(tableExpression: string)');
    expect(payments).toContain("this.tenantTable<IPaymentProviderConfig>('payment_provider_configs')");
    expect(payments).toContain("this.tenantTable<IInvoicePaymentLink>('invoice_payment_links')");
    expect(payments).toContain("this.tenantTable<IPaymentWebhookEvent>('payment_webhook_events')");
    expect(payments).toContain("this.tenantTable<InvoiceData>('invoices')");
    expect(payments).toContain("const db = tenantDb(this.knex, this.tenantId);");

    expectNoDirectRoots(`${scheduler}\n${invoicing}\n${payments}`, [
      'client_locations',
      'clients',
      'invoice_payment_links',
      'invoice_payments',
      'invoices',
      'payment_provider_configs',
      'payment_webhook_events',
      'tenant_extension_install',
      'tenant_extension_schedule',
      'users',
    ]);
  });
});
