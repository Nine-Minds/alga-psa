import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(repoRoot, relativePath), 'utf8');
}

function expectNoRawTenantJoin(source: string): void {
  expect(source).not.toMatch(/\.join\([^\n]*function\(/);
  expect(source).not.toMatch(/\.leftJoin\([^\n]*function\(/);
  expect(source).not.toMatch(/\.andOn\([^\n]*tenant/);
}

describe('survey, calendar, and email maintenance tenant facade joins', () => {
  it('routes survey service tenant-aware joins through tenantJoin', () => {
    const source = read('server/src/services/surveyService.ts');

    expect(source).toContain("import { tenantDb, withTransaction } from '@alga-psa/db';");
    expect(source).toContain("db.tenantJoin(query, `${CLIENTS_TABLE} as c`, 't.client_id', 'c.client_id'");
    expect(source).toContain("db.tenantJoin(query, `${USERS_TABLE} as u`, 't.assigned_to', 'u.user_id'");
    expect(source).toContain('tenantDb(knex, tenantId).table<TenantRow>(TENANTS_TABLE)');
    expect(source).not.toContain('knex<TenantRow>(TENANTS_TABLE)');
    expect(source).not.toContain(".where('tenant', tenantId)");
    expectNoRawTenantJoin(source);
  });

  it('routes survey analytics response joins through tenantJoin', () => {
    const source = read('server/src/services/SurveyAnalyticsService.ts');

    expect(source).toContain("import { tenantDb } from '@alga-psa/db';");
    expect(source).toContain('tenantDb(knex, tenantId).table(`${INVITATIONS_TABLE} as si`)');
    expect(source).toContain('tenantDb(knex, tenantId).table(`${RESPONSES_TABLE} as sr`)');
    expect(source).toContain("db.tenantJoin(query, `${TICKETS_TABLE} as t`, 'sr.ticket_id', 't.ticket_id'");
    expect(source).toContain("db.tenantJoin(query, `${CLIENTS_TABLE} as c`, 'sr.client_id', 'c.client_id'");
    expect(source).toContain("db.tenantJoin(responsesQuery, `${CONTACTS_TABLE} as ct`, 'sr.contact_id', 'ct.contact_name_id'");
    expect(source).toMatch(
      /tenantDb\(knex, tenantId\)\.tenantJoin\(\s*query,\s*`\$\{TICKETS_TABLE\} as t_filter`/
    );
    expect(source).not.toContain("knex(`${RESPONSES_TABLE} as sr`).where('sr.tenant', tenantId)");
    expect(source).not.toContain("knex(`${INVITATIONS_TABLE} as si`).where('si.tenant', tenantId)");
    expectNoRawTenantJoin(source);
  });

  it('routes survey response action roots through tenantDb', () => {
    const source = read('packages/surveys/src/actions/surveyResponseActions.ts');

    expect(source).toContain("import { tenantDb, withTransaction } from '@alga-psa/db';");
    expect(source).toContain('tenantDb(knex, tenant).table(SURVEY_INVITATIONS_TABLE)');
    expect(source).toContain('const db = tenantDb(trx, tenant);');
    expect(source).toContain('db.table<InvitationRow>(SURVEY_INVITATIONS_TABLE)');
    expect(source).toContain('db.table<ResponseRow>(SURVEY_RESPONSES_TABLE)');
    expect(source).not.toContain('knex(SURVEY_INVITATIONS_TABLE)');
    expect(source).not.toContain('trx<InvitationRow>(SURVEY_INVITATIONS_TABLE)');
    expect(source).not.toContain('trx<ResponseRow>(SURVEY_RESPONSES_TABLE)');
  });

  it('routes calendar webhook discovery joins through tenantJoin', () => {
    const processor = read('server/src/services/calendar/CalendarWebhookProcessor.ts');
    const maintenance = read('server/src/services/calendar/CalendarWebhookMaintenanceService.ts');

    expect(processor).toContain("discoveryDb.tenantJoin(query, 'calendar_providers as cp', 'gc.calendar_provider_id', 'cp.id'");
    expect(processor).toContain("discoveryDb.tenantJoin(query, 'calendar_providers as cp', 'mc.calendar_provider_id', 'cp.id'");
    expect(maintenance).toContain("tenantDb(knex, PROVIDER_TENANT_DISCOVERY).tenantJoin");
    expect(maintenance).toContain("'microsoft_calendar_provider_config as mcp'");
    expectNoRawTenantJoin(processor);
    expectNoRawTenantJoin(maintenance);
  });

  it('routes email webhook maintenance discovery joins through tenantJoin', () => {
    const source = read('shared/services/email/EmailWebhookMaintenanceService.ts');

    expect(source).toMatch(
      /tenantDb\(knex, tenantId\)\.tenantJoin\(\s*query,\s*'microsoft_email_provider_config as mpc'/
    );
    expect(source).toContain("tenantDb(knex, PROVIDER_TENANT_DISCOVERY).tenantJoin");
    expect(source).toContain("'microsoft_email_provider_config as mpc'");
    expectNoRawTenantJoin(source);
  });
});
