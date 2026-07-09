/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readJson(relativePath: string): any {
  return JSON.parse(read(relativePath));
}

function getPath(input: any, dottedPath: string): unknown {
  return dottedPath.split('.').reduce((value, key) => value?.[key], input);
}

describe('silent ticket close/update platform contracts', () => {
  it('T069: ticket locale files include the new i18n keys and pseudo locales mirror English', () => {
    const keyPaths = [
      'notifications.suppression.contactLabel',
      'notifications.suppression.contactHelper',
      'notifications.suppression.internalLabel',
      'conversation.closeStatus',
      'conversation.noStatusChange',
      'tickets.conversation.closeStatus',
      'tickets.conversation.noStatusChange',
      'bento.timeline.closeStatus',
      'bento.timeline.noStatusChange',
    ];
    const locales = ['en', 'fr', 'es', 'de', 'nl', 'it', 'pl', 'pt', 'xx', 'yy'];

    for (const locale of locales) {
      const messages = readJson(`server/public/locales/${locale}/features/tickets.json`);
      for (const keyPath of keyPaths) {
        expect(getPath(messages, keyPath), `${locale}.${keyPath}`).toBeTruthy();
      }
    }

    const english = readJson('server/public/locales/en/features/tickets.json');
    for (const locale of ['xx', 'yy']) {
      const pseudo = readJson(`server/public/locales/${locale}/features/tickets.json`);
      expect(Object.keys(pseudo.notifications.suppression).sort()).toEqual(
        Object.keys(english.notifications.suppression).sort(),
      );
      expect(Object.keys(pseudo.bento.timeline).sort()).toEqual(
        Object.keys(english.bento.timeline).sort(),
      );
    }
  });

  it('T070: subscriber suppression gates log a debug line that names suppression', () => {
    const sources = [
      'server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts',
      'server/src/lib/eventBus/subscribers/internalNotificationSubscriber.ts',
      'server/src/lib/eventBus/subscribers/surveySubscriber.ts',
    ].map(read).join('\n');

    const debugLines = sources
      .split('\n')
      .filter((line) => line.includes('logger.debug') && line.includes('due to suppression'));

    expect(debugLines.length).toBeGreaterThanOrEqual(8);
    expect(sources).toContain('Skipped ticket closed contact notification due to suppression');
    expect(sources).toContain('Skipped ticket updated contact notification due to suppression');
    expect(sources).toContain('Skipped ticket closed survey invitation due to suppression');
  });

  it('T071: v1 ticket update APIs accept, validate, strip, and publish suppression flags', () => {
    const schema = read('server/src/lib/api/schemas/ticket.ts');
    const service = read('server/src/lib/api/services/TicketService.ts');
    const sdkGenerator = read('server/src/lib/api/services/SdkGeneratorService.ts');

    expect(schema).toContain('suppressContactNotifications: z.boolean().optional()');
    expect(schema).toContain('suppressInternalNotifications: z.boolean().optional()');
    expect(service).toContain('delete (cleanedData as any).suppressContactNotifications');
    expect(service).toContain('delete (cleanedData as any).suppressInternalNotifications');
    expect(service).toContain('suppressInternalNotifications && !suppressContactNotifications');
    expect(service).toContain('suppressInternalNotifications requires suppressContactNotifications');
    expect(service).toContain('suppressContactNotifications,');
    expect(service).toContain('suppressInternalNotifications,');
    expect(sdkGenerator).toContain('suppressContactNotifications?: boolean');
    expect(sdkGenerator).toContain('suppressInternalNotifications?: boolean');
  });

  it('F065: workflow event catalog and runtime schemas expose the suppression flags', () => {
    const runtimeSchemas = read('shared/workflow/runtime/schemas/ticketEventSchemas.ts');
    const systemCatalog = read('ee/packages/workflows/src/models/eventCatalog.ts');
    const domainCatalogMigration = read('server/migrations/20260123150000_upsert_domain_workflow_event_catalog_v2.cjs');

    expect(runtimeSchemas).toContain('notificationSuppressionPayloadFields');
    expect(runtimeSchemas).toContain('suppressContactNotifications');
    expect(runtimeSchemas).toContain('suppressInternalNotifications');
    expect(systemCatalog).toContain('suppressContactNotifications: { type: \'boolean\', default: false }');
    expect(systemCatalog).toContain('suppressInternalNotifications: { type: \'boolean\', default: false }');
    expect(domainCatalogMigration).toContain('payload_schema_ref');
    expect(domainCatalogMigration).toContain('TICKET_ASSIGNED');
  });

  it('F062: new suppression and resolution controls use kebab-case ids', () => {
    const source = [
      'packages/tickets/src/components/ticket/TicketNotificationSuppressionControl.tsx',
      'packages/tickets/src/components/ticket/TicketInfo.tsx',
      'packages/tickets/src/components/ticket/bento/BentoHero.tsx',
      'packages/tickets/src/components/ticket/TicketConversation.tsx',
      'packages/tickets/src/components/ticket/bento/BentoTimelineTile.tsx',
      'packages/tickets/src/components/BulkChangeStatusDialog.tsx',
      'packages/tickets/src/components/BulkChangePriorityDialog.tsx',
      'packages/tickets/src/components/BulkAssignTicketsDialog.tsx',
      'packages/tickets/src/components/BulkSetDueDateDialog.tsx',
      'packages/tickets/src/components/TicketingDashboard.tsx',
    ].map(read).join('\n');

    const expectedIds = [
      'notification-suppression',
      'resolution-close-status-select',
      'composer-close-status-select',
      'bulk-move-notification-suppression',
      'ticket-bulk-status',
      'ticket-bulk-priority',
      'ticket-bulk-assign',
      'ticket-bulk-due-date',
    ];

    for (const id of expectedIds) {
      expect(source).toContain(id);
      expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });
});
