import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(fileName: string): string {
  return readFileSync(resolve(__dirname, fileName), 'utf8');
}

describe('email action tenant-scoped query contract', () => {
  it('uses tenantDb for inbound ticket defaults roots', () => {
    const text = source('inboundTicketDefaultsActions.ts');

    expect(text).toContain("import { createTenantKnex, tenantDb } from '@alga-psa/db';");
    expect(text).toContain("tenantDb(knex, tenant).table('statuses')");
    expect(text).toContain("tenantDb(knex, tenant).table('inbound_ticket_defaults')");
    expect(text).toContain("tenantDb(trx, tenant).table('email_providers')");
    expect(text).toContain("tenantDb(trx, tenant).table('clients')");
    expect(text).toContain("tenantDb(trx, tenant).table('contacts')");
    expect(text).toContain("tenantDb(trx, tenant).table('inbound_ticket_defaults')");
  });

  it('uses tenantDb for ticket field option lookup roots', () => {
    const text = source('ticketFieldOptionsActions.ts');

    expect(text).toContain("import { createTenantKnex, tenantDb } from '@alga-psa/db';");
    for (const table of [
      'boards',
      'statuses',
      'priorities',
      'categories',
      'clients',
      'users',
      'client_locations',
    ]) {
      expect(text).toContain(`tenantDb(knex, tenant).table('${table}')`);
    }
  });

  it('uses tenantDb for metadata-backed inbound rule helper roots', () => {
    const text = source('inboundEmailRulesActions.ts');

    expect(text).toContain("import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';");
    expect(text).toContain("tenantDb(trx, tenant).table('inbound_ticket_defaults')");
    expect(text).toContain(".table<{ addon_key: string; expires_at: string | Date | null }>('tenant_addons')");
    expect(text).toContain("tenantDb(trx, tenant)\n      .table('clients')");
  });

  it('uses tenantDb for tenant email settings upsert roots', () => {
    const text = source('emailSettingsActions.ts');

    expect(text).toContain("import { createTenantKnex, tenantDb } from '@alga-psa/db';");
    expect(text).toContain("const settingsTable = () => tenantDb(knex, tenant).table('tenant_email_settings');");
  });

  it('uses tenantDb and tenantJoin for email workflow helper roots', () => {
    const text = source('emailActions.ts');

    expect(text).toContain("import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';");
    for (const table of [
      'documents',
      'document_associations',
      'email_client_associations',
      'comments',
      'tickets',
      'clients',
      'boards',
    ]) {
      expect(text).toContain(`tenantDb(trx, tenant).table('${table}')`);
    }
    expect(text).toContain("const ticketQuery = db.table('tickets as t');");
    expect(text).toContain("db.tenantJoin(ticketQuery, 'statuses as s', 't.status_id', 's.status_id', { type: 'left' });");
  });
});
