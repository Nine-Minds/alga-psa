import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const readSource = (fileName: string): string =>
  fs.readFileSync(path.resolve(__dirname, fileName), 'utf8');

describe('client model tenant facade migration contract', () => {
  it('uses tenantDb for online meeting roots', () => {
    const source = readSource('./onlineMeeting.ts');

    expect(source).toContain("import { createTenantKnex, tenantDb } from '@alga-psa/db';");
    expect(source).toContain("tenantScopedTable<OnlineMeetingRow>(db, 'online_meetings', tenant)");
    expect(source).toContain("tenantScopedTable<IOnlineMeetingArtifact>(db, 'online_meeting_artifacts', tenant)");
    expect(source).not.toContain('.where({ tenant, meeting_id: meetingId })');
    expect(source).not.toContain('.where({ tenant, interaction_id: interactionId })');
  });

  it('uses tenantDb roots and tenantJoin for interaction tenant-table joins', () => {
    const source = readSource('./interactions.ts');

    expect(source).toContain("import { createTenantKnex, tenantDb } from '@alga-psa/db';");
    expect(source).toContain("facade.table('interactions')");
    expect(source).toContain("facade.tenantJoin(query, 'interaction_types as it'");
    expect(source).toContain("facade.tenantJoin(query, 'contacts'");
    expect(source).toContain("facade.tenantJoin(query, 'clients'");
    expect(source).toContain("facade.tenantJoin(query, 'users'");
    expect(source).toContain("facade.tenantJoin(query, 'statuses'");
    expect(source).toContain("facade.tenantJoin(query, 'system_interaction_types as sit'");
    expect(source).toContain("tenantScopedTable(db, scopedTenant, 'system_interaction_types')");
    expect(source).not.toContain("db('system_interaction_types')");
    expect(source).not.toContain(".andOn('interactions.tenant'");
  });

  it('uses tenantDb roots and tenantJoin for client contract assignment reads', () => {
    const source = readSource('./clientContract.ts');

    expect(source).toContain("import { createTenantKnex, tenantDb } from '@alga-psa/db';");
    expect(source).toContain("facade.table('client_contracts as cc')");
    expect(source).toContain("facade.tenantJoin(baseQuery, 'contracts as c'");
    expect(source).toContain("facade.tenantJoin(query, 'default_billing_settings as dbs'");
    expect(source).toContain("facade.tenantJoin(assignmentContractLinesQuery, 'contract_lines as cl'");
    expect(source).toContain("tenantDb(db, tenant).table('client_contracts')");
    expect(source).toContain("tenantDb(db, tenant).table('contract_lines')");
    expect(source).not.toContain("db('client_contracts as cc')");
  });
});
