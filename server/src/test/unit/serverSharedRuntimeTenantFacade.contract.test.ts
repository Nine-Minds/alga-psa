import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(repoRoot, relativePath), 'utf8');
}

function directRootPattern(tables: string[]): RegExp {
  return new RegExp(
    `\\b(?:knex|trx|db)\\s*(?:<[^>]+>)?\\(\\s*['"\`](?:${tables.join('|')})(?:\\s+as\\s+\\w+)?['"\`]`
  );
}

describe('server/shared runtime tenant facade roots', () => {
  it('routes service request definition lifecycle roots through tenantDb', () => {
    const files = [
      'server/src/lib/service-requests/definitionLifecycle.ts',
      'server/src/lib/service-requests/definitionPublishing.ts',
    ];
    const directServiceRequestRoot = directRootPattern([
      'service_request_definitions',
      'service_request_definition_versions',
      'service_categories',
      'service_catalog',
    ]);

    for (const file of files) {
      const source = read(file);

      expect(source, file).toContain("import { tenantDb } from '@alga-psa/db'");
      expect(source, file).not.toMatch(directServiceRequestRoot);
      expect(source, file).not.toMatch(/\.where\(\{\s*tenant\s*[,}:]/);
    }
  });

  it('routes service request management, portal, and submission roots through tenantDb', () => {
    const metadata = read('packages/db/src/lib/tenantTableMetadata.ts');
    for (const table of [
      'service_request_definition_versions',
      'service_request_submission_attachments',
      'service_request_submissions',
    ]) {
      expect(metadata).toContain(`${table}: { scope: 'tenant' }`);
    }

    const files = [
      'server/src/lib/service-requests/basicFormBuilder.ts',
      'server/src/lib/service-requests/definitionEditor.ts',
      'server/src/lib/service-requests/definitionManagement.ts',
      'server/src/lib/service-requests/definitionValidation.ts',
      'server/src/lib/service-requests/portalCatalog.ts',
      'server/src/lib/service-requests/portalDetail.ts',
      'server/src/lib/service-requests/submissionHistory.ts',
      'server/src/lib/service-requests/submissionService.ts',
      'server/src/lib/service-requests/providers/builtins/ticketOnlyExecutionProvider.ts',
    ];
    const directServiceRequestRoot = directRootPattern([
      'service_request_definitions',
      'service_request_definition_versions',
      'service_request_submissions',
      'service_request_submission_attachments',
      'service_categories',
      'service_catalog',
      'external_files',
      'boards',
      'priorities',
      'users',
      'clients',
      'contacts',
      'tickets',
    ]);

    for (const file of files) {
      const source = read(file);

      expect(source, file).toContain("tenantDb");
      expect(source, file).not.toMatch(directServiceRequestRoot);
    }
  });

  it('routes notification and SLA tenant roots through tenantDb', () => {
    const sendEventEmail = read('server/src/lib/notifications/sendEventEmail.ts');
    expect(sendEventEmail).toContain("tenantDb(knex, tenantId).table('email_reply_tokens')");
    expect(sendEventEmail).toContain("db.table('tenant_email_templates')");
    expect(sendEventEmail).toContain("db.table('tickets')");
    expect(sendEventEmail).not.toMatch(directRootPattern(['email_reply_tokens', 'tenant_email_templates', 'tickets']));
    expect(sendEventEmail).not.toMatch(/\.where\(\{\s*tenant:\s*params\.tenantId/);

    const slaSubscriber = read('server/src/lib/eventBus/subscribers/slaSubscriber.ts');
    expect(slaSubscriber).toContain("tenantDb(knex, tenantId).table('tenant_settings')");
    expect(slaSubscriber).toContain("tenantDb(trx, tenantId).table('tickets')");
    expect(slaSubscriber).not.toMatch(directRootPattern(['tenant_settings', 'tickets']));
    expect(slaSubscriber).not.toMatch(/\.where\(\{\s*tenant:\s*tenantId/);
  });

  it('routes RMM alert runtime roots through tenantDb', () => {
    const notificationSubscriber = read('server/src/lib/eventBus/subscribers/rmmAlertNotificationSubscriber.ts');
    expect(notificationSubscriber).toContain('const db = tenantDb(knex, tenantId);');
    expect(notificationSubscriber).toContain("db.table('rmm_alerts')");
    expect(notificationSubscriber).toContain("db.table('rmm_alert_rules')");
    expect(notificationSubscriber).toContain("db.table('notification_settings')");
    expect(notificationSubscriber).toContain("db.table('user_notification_preferences')");
    expect(notificationSubscriber).toContain("db.table('users')");
    expect(notificationSubscriber).not.toMatch(
      directRootPattern(['rmm_alerts', 'rmm_alert_rules', 'tickets', 'notification_settings', 'user_notification_preferences', 'users'])
    );

    const ticketClosedSubscriber = read('server/src/lib/eventBus/subscribers/rmmAlertTicketClosedSubscriber.ts');
    expect(ticketClosedSubscriber).toContain('const db = tenantDb(knex, tenantId);');
    expect(ticketClosedSubscriber).toContain("db.table('rmm_alerts as a')");
    expect(ticketClosedSubscriber).toContain("db.tenantJoin(alertsQuery, 'rmm_integrations as i'");
    expect(ticketClosedSubscriber).toContain("tenantDb(knex, tenantId).table('rmm_alert_rules')");
    expect(ticketClosedSubscriber).not.toMatch(
      directRootPattern(['rmm_alerts', 'rmm_alert_rules', 'rmm_integrations'])
    );

    const processor = read('shared/rmm/alerts/processRmmAlertEvent.ts');
    expect(processor).toContain("import { tenantDb } from '@alga-psa/db'");
    expect(processor).toContain("db.table('tenant_external_entity_mappings')");
    expect(processor).toContain("db.table('rmm_maintenance_windows')");
    expect(processor).toContain("db.table('rmm_alert_rules')");
    expect(processor).toContain("db.table('rmm_alerts as a')");
    expect(processor).toContain("db.tenantJoin(siblingQuery, 'tickets as t'");
    expect(processor).toContain("db.tenantJoin(siblingQuery, 'statuses as s'");
    expect(processor).not.toMatch(
      directRootPattern([
        'tenant_external_entity_mappings',
        'assets',
        'rmm_organization_mappings',
        'rmm_maintenance_windows',
        'rmm_alert_rules',
        'rmm_alerts',
        'tickets',
        'statuses',
      ])
    );

    const ticketCreator = read('shared/rmm/alerts/ticketCreator.ts');
    expect(ticketCreator).toContain("import { tenantDb } from '@alga-psa/db'");
    expect(ticketCreator).toContain("db.table('asset_associations')");
    expect(ticketCreator).not.toMatch(
      directRootPattern(['tickets', 'comment_threads', 'comments', 'users', 'asset_associations', 'boards', 'priorities'])
    );
  });

  it('routes shared client and ticket model tenant roots through tenantDb', () => {
    const clientModel = read('shared/models/clientModel.ts');
    expect(clientModel).toContain("import { tenantDb } from '@alga-psa/db'");
    expect(clientModel).toContain("tenantDb(trx, tenant).table('clients')");
    expect(clientModel).toContain("db.table('tax_rates')");
    expect(clientModel).toContain("db.table('client_tax_rates')");
    expect(clientModel).toContain("db.table('client_tax_settings')");
    expect(clientModel).not.toMatch(directRootPattern(['clients', 'tax_rates', 'client_tax_rates', 'client_tax_settings']));

    const ticketModel = read('shared/models/ticketModel.ts');
    expect(ticketModel).toContain("import { tenantDb } from '@alga-psa/db'");
    expect(ticketModel).toContain("db.tenantJoin(parentQuery, 'comment_threads as thread'");
    expect(ticketModel).not.toMatch(
      directRootPattern([
        'client_locations',
        'categories',
        'statuses',
        'tickets',
        'ticket_resources',
        'contacts',
        'comments',
        'comment_threads',
        'tenant_settings',
        'users',
        'boards',
        'priorities',
      ])
    );
  });
});
