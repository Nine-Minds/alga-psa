import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

function sectionBetween(text: string, startMarker: string, endMarker: string): string {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return text.slice(start, end);
}

describe('inbound email tenant-scoped query contract', () => {
  it('uses tenantDb for inbound webhook lookup roots', () => {
    const text = source('../../lib/actions/inboundWebhookLookups.ts');

    expect(text).toContain("import { createTenantKnex, tenantDb } from '@alga-psa/db';");
    expect(text).toContain('const db = tenantDb(knex, tenant);');
    for (const table of [
      'clients',
      'boards',
      'statuses',
      'priorities',
      'categories',
      'users',
      'teams',
      'contacts',
      'client_locations',
      'assets',
      'service_catalog',
    ]) {
      expect(text).toContain(`db.table('${table}')`);
    }
    expect(text).toContain("tenantDb(knex, tenant).table<IClient>('clients')");
    expect(text).toContain("tenantDb(knex, tenant).table<IUser>('users')");
    expect(text).toContain(".table<{ team_id: string; team_name: string; manager_id: string | null; tenant: string }>('teams')");
  });

  it('uses tenantDb for inbound workflow option roots', () => {
    const text = source('../../lib/actions/inboundWebhookActions.ts');
    const section = sectionBetween(text, 'export const listInboundWorkflowOptions', 'export const getInboundWebhook');

    expect(text).toContain("import { createTenantKnex, tenantDb } from '@alga-psa/db';");
    expect(section).toContain('const db = tenantDb(knex, tenant);');
    expect(section).toContain("db.table('workflow_definition_versions')");
    expect(section).toContain("db.table('workflow_definitions as workflow_definitions')");
    expect(section).not.toContain("knex('workflow_definition_versions')");
    expect(section).not.toContain("knex('workflow_definitions as workflow_definitions')");
  });

  it('uses tenantDb and tenantJoin for ticket comment inline image document lookups', () => {
    const text = source('../../lib/eventBus/subscribers/ticketCommentInlineImageEmail.ts');

    expect(text).toContain("import { tenantDb } from '@alga-psa/db';");
    expect(text).toContain('const db = tenantDb(params.db, params.tenantId);');
    expect(text).toContain("const ticketImageDocumentsQuery = db.table('documents as d');");
    expect(text).toContain(
      "db.tenantJoin(ticketImageDocumentsQuery, 'document_associations as da', 'da.document_id', 'd.document_id');",
    );
    expect(text).not.toContain("params.db('documents as d')");
  });
});
