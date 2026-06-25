// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('optimized ticket action tenant-scoped authorization SQL contract', () => {
  it('uses tenant-scoped query wrappers for ticket read authorization SQL', () => {
    const source = fs.readFileSync(path.resolve(__dirname, './optimizedTicketActions.ts'), 'utf8');

    expect(source).toContain('createTenantScopedQuery');
    expect(source).toContain('function tenantScopedTable(');
    expect(source).toContain('cloneTenantScopedQuery');
    expect(source).toContain('compileTenantScopedResourceReadAuthorizationSql');
    expect(source).not.toContain('compileResourceReadAuthorizationSql,');
  });

  it('uses structural tenant scoping for authorization subject and response-state roots', () => {
    const source = fs.readFileSync(path.resolve(__dirname, './optimizedTicketActions.ts'), 'utf8');
    const authStart = source.indexOf('async function resolveAuthorizationSubjectForUser');
    const authEnd = source.indexOf('function toTicketAuthorizationRecord', authStart);
    const responseStart = source.indexOf('async function updateTicketResponseStateFromComment');
    const responseEnd = source.indexOf('// Helper function to safely convert dates', responseStart);

    expect(authStart).toBeGreaterThanOrEqual(0);
    expect(authEnd).toBeGreaterThan(authStart);
    expect(responseStart).toBeGreaterThanOrEqual(0);
    expect(responseEnd).toBeGreaterThan(responseStart);

    const authSection = source.slice(authStart, authEnd);
    const responseSection = source.slice(responseStart, responseEnd);

    expect(authSection).toContain("tenantScopedTable(trx, 'user_roles', tenant)");
    expect(authSection).toContain("tenantScopedTable(trx, 'team_members', tenant)");
    expect(authSection).toContain("tenantScopedTable(trx, 'users', tenant)");
    expect(authSection).not.toContain(".where({ tenant, user_id: user.user_id })");
    expect(authSection).not.toContain(".where({ tenant, reports_to: user.user_id })");

    expect(responseSection).toContain("tenantScopedTable(trx, 'tickets', tenant)");
    expect(responseSection).not.toContain(".where({ ticket_id: ticketId, tenant })");
  });
});
