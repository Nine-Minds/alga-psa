import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { runWithTenant, tenantDb } from '@alga-psa/db';
import {
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
  upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';
import { authorizeTicketRecordAccess } from '@alga-psa/tickets/lib/ticketRecordAuthorization';
import { resolveSearchAclPrincipal } from '@alga-psa/search/acl';
import { runAppSearch } from '@alga-psa/search/runAppSearch';
import { TestContext } from '../../../test-utils/testContext';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';
import { createCloseRulesFixture, insertTicket, insertResolutionComment } from './helpers/closeRulesFixture';

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 900_000;
const SEARCH_TABLE = `search_authz_prod_${randomUUID().replaceAll('-', '')}`;
const SEARCH_INDEX = { sql: `(SELECT * FROM ${SEARCH_TABLE}) s`, bindings: [] };

describe('production ticket search authorization on PostgreSQL', () => {
  let ctx: TestContext;
  let fixture: Awaited<ReturnType<typeof createCloseRulesFixture>>;
  let db: Knex;
  let allowedClient: string;
  let deniedClient: string;
  let allowedTicket: string;
  let deniedTicket: string;
  let publicComment: string;
  let privateComment: string;
  let scheduledComment: string;
  let deletedComment: string;
  let bundleRuleId: string;
  let portalUser: any;
  let foreignTenantComment: string;
  let deniedParentComment: string;
  let deletedParentComment: string;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({ cleanupTables: ['authorization_bundle_assignments', 'authorization_bundle_rules', 'authorization_bundle_revisions', 'authorization_bundles'] });
    db = ctx.db;
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    db = ctx.db;
    await db.raw(`CREATE TABLE ${SEARCH_TABLE} (
      tenant uuid NOT NULL, object_type text NOT NULL, object_id text NOT NULL,
      parent_type text, parent_id text, title text NOT NULL, subtitle text, url text NOT NULL,
      source_updated_at timestamptz NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      body text, visible_to_user_ids uuid[] NOT NULL DEFAULT '{}', visible_to_roles text[] NOT NULL DEFAULT '{}',
      is_internal_only boolean NOT NULL DEFAULT false, is_private boolean NOT NULL DEFAULT false,
      client_scope_id uuid, required_permission text, search_vector tsvector NOT NULL,
      PRIMARY KEY (tenant, object_type, object_id))`);
    fixture = await createCloseRulesFixture(db, ctx.tenantId, ctx.user.user_id);
    const roleId = randomUUID();
    const permissionId = randomUUID();
    await tenantDb(db, ctx.tenantId).table('roles').insert({ tenant: ctx.tenantId, role_id: roleId, role_name: `Search reader ${roleId}`, msp: true, client: false });
    await tenantDb(db, ctx.tenantId).table('permissions').insert({ tenant: ctx.tenantId, permission_id: permissionId, resource: 'ticket', action: 'read', msp: true, client: false });
    await tenantDb(db, ctx.tenantId).table('role_permissions').insert({ tenant: ctx.tenantId, role_id: roleId, permission_id: permissionId });
    await tenantDb(db, ctx.tenantId).table('user_roles').insert({ tenant: ctx.tenantId, user_id: ctx.user.user_id, role_id: roleId });
    const portalUserId = await createUser(db, ctx.tenantId, { user_type: 'client', contact_id: fixture.contactId });
    const portalRoleId = randomUUID();
    const portalPermissionId = randomUUID();
    await tenantDb(db, ctx.tenantId).table('roles').insert({ tenant: ctx.tenantId, role_id: portalRoleId, role_name: `Portal search reader ${portalRoleId}`, msp: false, client: true });
    await tenantDb(db, ctx.tenantId).table('permissions').insert({ tenant: ctx.tenantId, permission_id: portalPermissionId, resource: 'ticket', action: 'read', msp: false, client: true });
    await tenantDb(db, ctx.tenantId).table('role_permissions').insert({ tenant: ctx.tenantId, role_id: portalRoleId, permission_id: portalPermissionId });
    await tenantDb(db, ctx.tenantId).table('user_roles').insert({ tenant: ctx.tenantId, user_id: portalUserId, role_id: portalRoleId });
    allowedClient = fixture.clientId;
    portalUser = { ...ctx.user, user_id: portalUserId, user_type: 'client', contact_id: fixture.contactId, clientId: allowedClient, roles: [] };
    deniedClient = await createClient(db, ctx.tenantId, `Search denied ${randomUUID()}`);
    allowedTicket = await insertTicket(db, fixture, { client_id: allowedClient, contact_name_id: null });
    deniedTicket = await insertTicket(db, fixture, { client_id: deniedClient, contact_name_id: null });
    publicComment = await insertResolutionComment(db, fixture, allowedTicket, { is_internal: false, publish_state: 'published' });
    privateComment = await insertResolutionComment(db, fixture, allowedTicket, { is_internal: true, publish_state: 'published' });
    scheduledComment = await insertResolutionComment(db, fixture, allowedTicket, { is_internal: false, publish_state: 'scheduled' });
    deletedComment = await insertResolutionComment(db, fixture, allowedTicket, { is_internal: false, publish_state: 'published', deleted_at: new Date() });
    const foreignTenant = await createTenant(db, `Search isolated tenant ${randomUUID()}`);
    const foreignUser = await createUser(db, foreignTenant);
    const foreignFixture = await createCloseRulesFixture(db, foreignTenant, foreignUser);
    const foreignTicket = await insertTicket(db, foreignFixture);
    foreignTenantComment = await insertResolutionComment(db, foreignFixture, foreignTicket, { is_internal: false, publish_state: 'published' });
    for (const [commentId, audience] of [[publicComment, 'requester'], [privateComment, 'organization_private']] as const) {
      const comment = await tenantDb(db, ctx.tenantId).table('comments').where({ comment_id: commentId }).first('thread_id');
      await tenantDb(db, ctx.tenantId).table('comment_threads').where({ thread_id: comment.thread_id }).update({
        collaboration_audience: audience,
        is_internal: audience !== 'requester',
      });
    }
    deniedParentComment = await insertResolutionComment(db, fixture, deniedTicket, { is_internal: false, publish_state: 'published' });
    const deletedParentTicket = await insertTicket(db, fixture, { client_id: allowedClient, contact_name_id: null });
    deletedParentComment = await insertResolutionComment(db, fixture, deletedParentTicket, { is_internal: false, publish_state: 'published' });
    const deletedParentThread = await tenantDb(db, ctx.tenantId).table('comments').where({ comment_id: deletedParentComment }).first('thread_id');
    await tenantDb(db, ctx.tenantId).table('comments').where({ comment_id: deletedParentComment }).delete();
    await tenantDb(db, ctx.tenantId).table('comment_threads').where({ thread_id: deletedParentThread.thread_id }).delete();
    await tenantDb(db, ctx.tenantId).table('tickets').where({ ticket_id: deletedParentTicket }).delete();

    const bundle = await createAuthorizationBundle(db, {
      tenant: ctx.tenantId,
      name: `Search selected clients ${randomUUID()}`,
      actorUserId: ctx.user.user_id,
    });
    await upsertBundleRule(db, {
      tenant: ctx.tenantId,
      bundleId: bundle.bundleId,
      revisionId: bundle.revisionId,
      resourceType: 'ticket',
      action: 'read',
      templateKey: 'selected_clients',
      config: { selectedClientIds: [allowedClient] },
      actorUserId: ctx.user.user_id,
    });
    const rule = await tenantDb(db, ctx.tenantId).table('authorization_bundle_rules')
      .where({ revision_id: bundle.revisionId, template_key: 'selected_clients' })
      .first('rule_id');
    bundleRuleId = rule.rule_id;
    await publishBundleRevision(db as any, {
      tenant: ctx.tenantId,
      bundleId: bundle.bundleId,
      revisionId: bundle.revisionId,
      actorUserId: ctx.user.user_id,
    });
    await createBundleAssignment(db, {
      tenant: ctx.tenantId,
      bundleId: bundle.bundleId,
      targetType: 'user',
      targetId: ctx.user.user_id,
      actorUserId: ctx.user.user_id,
    });

    const commentIds = [publicComment, privateComment, scheduledComment, deletedComment, deniedParentComment, deletedParentComment, randomUUID(), foreignTenantComment];
    const rows = [
      ...[allowedTicket, deniedTicket].map((ticketId) => ({ object_type: 'ticket', object_id: ticketId, required_permission: 'ticket:read' })),
      ...commentIds.map((commentId) => ({ object_type: 'ticket_comment', object_id: commentId, required_permission: 'ticket:read' })),
    ];
    await db(SEARCH_TABLE).insert(rows.map((row) => ({
      tenant: ctx.tenantId,
      ...row,
      title: 'Needle source record',
      url: `/search/${row.object_type}/${row.object_id}`,
      source_updated_at: '2026-01-01T00:00:00.000Z',
      metadata: JSON.stringify({}),
      body: 'needle source',
      search_vector: db.raw("to_tsvector('english', 'needle source')"),
    })));
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await helpers.afterEach();
  });

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  it('uses the actual principal resolver, SQL compiler and record evaluator with production UUID columns', async () => {
    await runWithTenant(ctx.tenantId, async () => {
    const principal = await resolveSearchAclPrincipal(db, ctx.user, { mode: 'all' });
    expect(principal.permissions).toContain('ticket:read');
    expect(principal.ticketPolicySqlSupported).toBe(true);

    await expect(authorizeTicketRecordAccess({ trx: db, tenant: ctx.tenantId, user: ctx.user, ticketId: allowedTicket, action: 'read' })).resolves.toBeTruthy();
    await expect(authorizeTicketRecordAccess({ trx: db, tenant: ctx.tenantId, user: ctx.user, ticketId: deniedTicket, action: 'read' })).rejects.toThrow('Permission denied');

    const compiled = await runAppSearch(db, ctx.tenantId, ctx.user, { query: 'needle', types: ['ticket', 'ticket_comment'] as any, limit: 10 }, SEARCH_INDEX);
    expect(compiled.results.map(({ id }) => id)).toEqual(expect.arrayContaining([allowedTicket, publicComment, privateComment]));
    expect(compiled.results.map(({ id }) => id)).not.toEqual(expect.arrayContaining([deniedTicket, scheduledComment, deletedComment, deniedParentComment, deletedParentComment, foreignTenantComment]));
    expect(compiled.totalCount).toBe(3);
    expect(compiled.groups.ticket).toBe(1);
    expect(compiled.groups.ticket_comment).toBe(2);
    });
  }, 60_000);

  it('enforces requester audience and portal client scope in compiled PostgreSQL search', async () => {
    await runWithTenant(ctx.tenantId, async () => {
      const portalPrincipal = await resolveSearchAclPrincipal(db, portalUser, { mode: 'scoped', clientIds: [allowedClient] });
      expect(portalPrincipal.ticketPolicySqlSupported).toBe(true);
      const result = await runAppSearch(db, ctx.tenantId, portalUser, {
        query: 'needle', types: ['ticket', 'ticket_comment'] as any, limit: 10,
      }, SEARCH_INDEX);
      expect(result.results.map(({ id }) => id)).toEqual(expect.arrayContaining([allowedTicket, publicComment]));
      expect(result.results.map(({ id }) => id)).not.toEqual(expect.arrayContaining([deniedTicket, privateComment, scheduledComment, deletedComment, deniedParentComment, deletedParentComment, foreignTenantComment]));
      expect(result.totalCount).toBe(2);
    });
  }, 60_000);

  it('matches evaluator decisions when the resolved policy is unrestricted', async () => {
    await runWithTenant(ctx.tenantId, async () => {
      await tenantDb(db, ctx.tenantId).table('authorization_bundle_assignments')
        .where({ target_type: 'user', target_id: ctx.user.user_id }).delete();
      const principal = await resolveSearchAclPrincipal(db, ctx.user, { mode: 'all' });
      expect(principal.ticketPolicySqlSupported).toBe(true);
      const readableByEvaluator = await Promise.all([allowedTicket, deniedTicket].map(async (ticketId) => {
        try {
          await authorizeTicketRecordAccess({ trx: db, tenant: ctx.tenantId, user: ctx.user, ticketId, action: 'read' });
          return ticketId;
        } catch {
          return null;
        }
      }));
      expect(readableByEvaluator.filter(Boolean)).toEqual([allowedTicket, deniedTicket]);
      const result = await runAppSearch(db, ctx.tenantId, ctx.user, { query: 'needle', types: ['ticket', 'ticket_comment'] as any, limit: 10 }, SEARCH_INDEX);
      expect(result.results.map(({ id }) => id)).toEqual(expect.arrayContaining([allowedTicket, deniedTicket, publicComment, privateComment, deniedParentComment]));
      expect(result.totalCount).toBe(5);
    });
  }, 60_000);

  it('uses the complete record policy in batched fallback for unsupported constraints', async () => {
    await runWithTenant(ctx.tenantId, async () => {
    await tenantDb(db, ctx.tenantId).table('authorization_bundle_rules')
      .where({ rule_id: bundleRuleId })
      .update({ constraint_key: 'future_ticket_visibility' });
    const principal = await resolveSearchAclPrincipal(db, ctx.user, { mode: 'all' });
    expect(principal.ticketPolicySqlSupported).toBe(false);

    const result = await runAppSearch(db, ctx.tenantId, ctx.user, { query: 'needle', types: ['ticket', 'ticket_comment'] as any, limit: 10 }, SEARCH_INDEX);
    expect(result.results.map(({ id }) => id)).toEqual(expect.arrayContaining([allowedTicket, publicComment, privateComment]));
    expect(result.results.map(({ id }) => id)).not.toEqual(expect.arrayContaining([deniedTicket, scheduledComment, deletedComment]));
    expect(result.totalCount).toBe(3);
    });
  }, 60_000);

  it('fails closed when policy resolution rejects', async () => {
    await runWithTenant(ctx.tenantId, async () => {
    const bundleService = await import('@alga-psa/authorization/bundles/service');
    const resolver = vi.spyOn(bundleService, 'resolveBundleNarrowingRulesForEvaluation').mockRejectedValue(new Error('resolver unavailable'));
    try {
      const result = await resolveSearchAclPrincipal(db, ctx.user, { mode: 'all' });
      expect(result.ticketAuthorizationResolutionFailed).toBe(true);
      const search = await runAppSearch(db, ctx.tenantId, ctx.user, { query: 'needle', types: ['ticket', 'ticket_comment'] as any, limit: 10 }, SEARCH_INDEX);
      expect(search.results).toEqual([]);
      expect(search.totalCount).toBe(0);
    } finally {
      resolver.mockRestore();
    }
    });
  }, 60_000);
});
