import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'surveyTokenService.ts'), 'utf8');

describe('surveyTokenService tenant-scoped query contract', () => {
  it('uses an explicit unscoped boundary for public token tenant discovery', () => {
    expect(source).toContain('tenantDb(admin, SURVEY_TOKEN_DISCOVERY_TENANT)');
    expect(source).toContain('.unscoped<InvitationLookupRow>(SURVEY_INVITATIONS_TABLE, SURVEY_TOKEN_DISCOVERY_REASON)');
    expect(source).toContain('tenant discovery for public survey token lookup');
    expect(source).not.toContain('admin<InvitationLookupRow>(SURVEY_INVITATIONS_TABLE)');
  });

  it('uses structural tenant scoping for tenant-known invitation and template lookups', () => {
    expect(source).toContain('const db = tenantDb(knex, tenantId);');
    expect(source).toContain('db.table<InvitationDetailRow>(SURVEY_INVITATIONS_TABLE)');
    expect(source).toContain('db.tenantJoin(');
    expect(source).toContain('SURVEY_TEMPLATES_TABLE');
    expect(source).not.toContain('knex<InvitationDetailRow>(SURVEY_INVITATIONS_TABLE)');
    expect(source).not.toContain('.innerJoin(SURVEY_TEMPLATES_TABLE');
  });
});
