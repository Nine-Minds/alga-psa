// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('optimized ticket action tenant-scoped authorization SQL contract', () => {
  it('uses tenant-scoped query wrappers for ticket read authorization SQL', () => {
    const source = fs.readFileSync(path.resolve(__dirname, './optimizedTicketActions.ts'), 'utf8');

    expect(source).toContain('tenantDb');
    expect(source).toContain('function tenantScopedTable(');
    expect(source).toContain('tenantDb(conn, tenant).table(table)');
    expect(source).toContain("tenantDb(trx, tenant).scoped('tickets as t')");
    expect(source).toContain('scopedQuery.clone()');
    expect(source).toContain('scopedQuery.withBuilder(baseQuery)');
    expect(source).toContain('compileTenantScopedResourceReadAuthorizationSql');
    expect(source).not.toContain('createTenantScopedQuery');
    expect(source).not.toContain('cloneTenantScopedQuery');
    expect(source).not.toContain('withTenantScopedQueryBuilder');
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

  it('uses structural tenant scoping for consolidated ticket top-level hydration roots', () => {
    const source = fs.readFileSync(path.resolve(__dirname, './optimizedTicketActions.ts'), 'utf8');
    const start = source.indexOf('export const getConsolidatedTicketData');
    const end = source.indexOf('// Fetch specific client and contact data if available', start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const section = source.slice(start, end);

    expect(section).toContain("tenantScopedTable(trx, 'tickets as t', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'comments', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'documents as d', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'clients as c', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'ticket_resources', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'users', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'statuses', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'boards', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'priorities', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'categories', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'documents', tenant)");
    expect(section).not.toContain("'t.tenant': tenant");
    expect(section).not.toContain('tenant: tenant');
    expect(section).not.toContain(".where({ 'c.tenant': tenant })");
    expect(section).not.toContain(".where({ tenant })");
    expect(section).not.toContain(".andWhere({ tenant })");
  });

  it('uses structural tenant scoping for consolidated ticket client and bundle roots', () => {
    const source = fs.readFileSync(path.resolve(__dirname, './optimizedTicketActions.ts'), 'utf8');
    const start = source.indexOf('// Fetch specific client and contact data if available');
    const end = source.indexOf('// Track ticket view analytics', start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const section = source.slice(start, end);

    expect(section).toContain("tenantScopedTable(trx, 'clients as c', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'contacts', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'client_locations', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'users', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'boards', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'schedule_entries as se', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'ticket_bundle_settings', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'tickets as ct', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'tickets as mt', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'comments as c', tenant)");
    expect(section).not.toContain("'c.tenant': tenant");
    expect(section).not.toContain('tenant: tenant');
    expect(section).not.toContain(".andWhere({ tenant })");
    expect(section).not.toContain(".where({ tenant, master_ticket_id");
    expect(section).not.toContain("'ct.tenant': tenant");
    expect(section).not.toContain("'mt.tenant': tenant");
  });

  it('uses structural tenant scoping for ticket list and form option roots', () => {
    const source = fs.readFileSync(path.resolve(__dirname, './optimizedTicketActions.ts'), 'utf8');
    const listBaseStart = source.indexOf('async function buildTicketListBaseQuery');
    const listBaseEnd = source.indexOf('function buildTicketListSearchPrefixTsquery', listBaseStart);
    const listActionStart = source.indexOf('export const getTicketsForList');
    const listActionEnd = source.indexOf('export const getAllMatchingTicketIds', listActionStart);
    const boardIdsStart = source.indexOf('export const getTicketBoardIds');
    const boardIdsEnd = source.indexOf('export const getTicketFormOptions', boardIdsStart);
    const optionsStart = source.indexOf('export const getTicketFormOptions');
    const optionsEnd = source.indexOf('export async function updateTicketInTransaction', optionsStart);

    expect(listBaseStart).toBeGreaterThanOrEqual(0);
    expect(listBaseEnd).toBeGreaterThan(listBaseStart);
    expect(listActionStart).toBeGreaterThanOrEqual(0);
    expect(listActionEnd).toBeGreaterThan(listActionStart);
    expect(boardIdsStart).toBeGreaterThanOrEqual(0);
    expect(boardIdsEnd).toBeGreaterThan(boardIdsStart);
    expect(optionsStart).toBeGreaterThanOrEqual(0);
    expect(optionsEnd).toBeGreaterThan(optionsStart);

    const listBaseSection = source.slice(listBaseStart, listBaseEnd);
    const listActionSection = source.slice(listActionStart, listActionEnd);
    const boardIdsSection = source.slice(boardIdsStart, boardIdsEnd);
    const optionsSection = source.slice(optionsStart, optionsEnd);

    expect(listBaseSection).toContain("tenantScopedTable(trx, 'boards', tenant)");
    expect(listBaseSection).not.toContain(".where('tenant', tenant)");

    expect(listActionSection).toContain("tenantScopedTable(trx, 'tag_mappings as tm', tenant)");
    expect(listActionSection).not.toContain(".where('tm.tenant', tenant)");

    expect(boardIdsSection).toContain("tenantScopedTable(trx, 'tickets as t', tenant)");
    expect(boardIdsSection).not.toContain(".where('t.tenant', tenant)");

    expect(optionsSection).toContain("tenantScopedTable(trx, 'statuses', tenant)");
    expect(optionsSection).toContain("tenantScopedTable(trx, 'priorities', tenant)");
    expect(optionsSection).toContain("tenantScopedTable(trx, 'boards', tenant)");
    expect(optionsSection).toContain("tenantScopedTable(trx, 'categories', tenant)");
    expect(optionsSection).toContain("tenantScopedTable(trx, 'clients as c', tenant)");
    expect(optionsSection).toContain("tenantScopedTable(trx, 'users', tenant)");
    expect(optionsSection).not.toContain(".where({ tenant, item_type: 'ticket' })");
    expect(optionsSection).not.toContain(".where({ tenant })");
    expect(optionsSection).not.toContain(".where({ 'c.tenant': tenant })");
  });

  it('uses tenant facade-derived tables for ticket list indexed search roots', () => {
    const source = fs.readFileSync(path.resolve(__dirname, './optimizedTicketActions.ts'), 'utf8');
    const start = source.indexOf('function applyTicketListIndexedSearchFilter');
    const end = source.indexOf('function applyTicketListSort', start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const section = source.slice(start, end);

    expect(section).toContain("tenantScopedDerivedTableSql(trx, tenant, 'app_search_index', 'si')");
    expect(section).toContain("tenantScopedDerivedTableSql(trx, tenant, 'tickets', 't2')");
    expect(section).toContain("tenantScopedDerivedTableSql(trx, tenant, 'tickets', 'child')");
    expect(section).toContain("tenantScopedDerivedTableSql(trx, tenant, 'tickets', 'tc')");
    expect(section).toContain("const childSearchIndexTenantPredicate = tenantWhereColumnSql(trx, tenant, 'child.tenant', 'si.tenant')");
    expect(section).toContain('ON ${childSearchIndexTenantPredicate.sql}');
    expect(section).toContain('const searchMatchesJoin = tenantJoinSubquerySql(');
    expect(section).toContain('trx.raw(unionSql, unionBindings)');
    expect(section).toContain("rootTenantColumn: 't.tenant'");
    expect(section).toContain("joinedTenantColumn: 'sm.tenant'");
    expect(section).toContain('return baseQuery.joinRaw(searchMatchesJoin.sql');
    expect(section).toContain('...searchIndex.bindings');
    expect(section).toContain('...titleSearchTickets.bindings');
    expect(section).toContain('...childSearchIndexTenantPredicate.bindings');
    expect(section).toMatch(/legDBindings\.push\([\s\S]*\.\.\.childTickets\.bindings,[\s\S]*\.\.\.childSearchIndexTenantPredicate\.bindings,[\s\S]*\['ticket', 'ticket_comment'\]/);
    expect(section).toMatch(/const unionBindings: Knex\.RawBinding\[\] = \[[\s\S]*\.\.\.legABindings,[\s\S]*\.\.\.legBBindings,[\s\S]*\.\.\.legDBindings,[\s\S]*\]/);
    expect(section).not.toContain('FROM app_search_index si');
    expect(section).not.toContain('WHERE si.tenant = ?::uuid');
    expect(section).not.toContain('FROM tickets t2');
    expect(section).not.toContain('WHERE t2.tenant = ?::uuid');
    expect(section).not.toContain('FROM tickets tc');
    expect(section).not.toContain('WHERE tc.tenant = ?::uuid');
    expect(section).not.toContain('child.tenant = si.tenant');
    expect(section).not.toContain('sm.tenant = t.tenant');
  });

  it('uses structural tenant scoping for ticket update transaction roots', () => {
    const source = fs.readFileSync(path.resolve(__dirname, './optimizedTicketActions.ts'), 'utf8');
    const start = source.indexOf('export async function updateTicketInTransaction');
    const end = source.indexOf('export const updateTicketWithCache', start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const section = source.slice(start, end);

    expect(section).toContain("tenantScopedTable(trx, 'tickets', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'priorities', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'categories', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'statuses', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'ticket_resources', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'ticket_bundle_settings', tenant)");
    expect(section).not.toContain(".where({ ticket_id: id, tenant: tenant })");
    expect(section).not.toContain(".where('tenant', tenant)");
    expect(section).not.toContain('tenant: tenant,');
    expect(section).not.toContain('.where({ tenant, master_ticket_id: id })');
  });

  it('uses structural tenant scoping for optimized comment mirroring and bundle child roots', () => {
    const source = fs.readFileSync(path.resolve(__dirname, './optimizedTicketActions.ts'), 'utf8');
    const commentStart = source.indexOf('export const addTicketCommentWithCache');
    const commentEnd = source.indexOf('export async function addTicketCommentWithCacheForCurrentUser', commentStart);
    const bundleStart = source.indexOf('export const fetchBundleChildrenForMaster');
    const bundleEnd = source.indexOf('export const getTicketsForListWithCursor', bundleStart);

    expect(commentStart).toBeGreaterThanOrEqual(0);
    expect(commentEnd).toBeGreaterThan(commentStart);
    expect(bundleStart).toBeGreaterThanOrEqual(0);
    expect(bundleEnd).toBeGreaterThan(bundleStart);

    const commentSection = source.slice(commentStart, commentEnd);
    const bundleSection = source.slice(bundleStart, bundleEnd);

    expect(commentSection).toContain("tenantScopedTable(trx, 'ticket_bundle_settings', tenant)");
    expect(commentSection).toContain("tenantScopedTable(trx, 'tickets', tenant)");
    expect(commentSection).toContain("tenantScopedTable(trx, 'ticket_bundle_mirrors', tenant)");
    expect(commentSection).not.toContain('.where({ tenant, master_ticket_id: ticketId })');
    expect(commentSection).not.toContain('.where({\n              tenant,\n              source_comment_id');

    expect(bundleSection).toContain("tenantScopedTable(trx, 'tickets as t', tenant)");
    expect(bundleSection).not.toContain("'t.tenant': tenant");
  });
});
