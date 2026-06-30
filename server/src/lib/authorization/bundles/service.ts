import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { AuthorizationEvaluationInput, RelationshipTemplateKey } from '../kernel';
import type { BundleNarrowingRule } from '../kernel/providers/bundleProvider';
import { assertBundleRuleCatalogInput } from './catalog';

export type AuthorizationBundleTargetType = 'role' | 'team' | 'user' | 'api_key';

export interface BundleAssignmentTarget {
  tenant: string;
  targetType: AuthorizationBundleTargetType;
  targetId: string;
}

export interface CreateBundleAssignmentInput extends BundleAssignmentTarget {
  bundleId: string;
  actorUserId?: string | null;
}

export interface PublishBundleRevisionInput {
  tenant: string;
  bundleId: string;
  revisionId: string;
  actorUserId?: string | null;
}

export interface UpsertBundleRuleInput {
  tenant: string;
  bundleId: string;
  revisionId: string;
  ruleId?: string;
  resourceType: string;
  action: string;
  templateKey: string;
  constraintKey?: string | null;
  config?: Record<string, unknown>;
  position?: number;
  actorUserId?: string | null;
}

export interface CreateAuthorizationBundleInput {
  tenant: string;
  name: string;
  description?: string | null;
  bundleKey?: string | null;
  isSystem?: boolean;
  actorUserId?: string | null;
}

export interface AuthorizationBundleLibraryItem {
  bundleId: string;
  bundleKey: string | null;
  name: string;
  description: string | null;
  isSystem: boolean;
  status: 'active' | 'archived';
  publishedRevisionId: string | null;
  assignmentCount: number;
  updatedAt: string;
}

export interface BundleRuleRecord {
  ruleId: string;
  resourceType: string;
  action: string;
  templateKey: string;
  constraintKey: string | null;
  config: Record<string, unknown>;
  position: number;
}

function isDraftRevisionUniquenessViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { code?: string; message?: string };
  return (
    candidate.code === '23505' &&
    typeof candidate.message === 'string' &&
    candidate.message.includes('authorization_bundle_revisions_single_draft_idx')
  );
}

function isRevisionNumberUniquenessViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { code?: string; message?: string };
  return (
    candidate.code === '23505' &&
    typeof candidate.message === 'string' &&
    candidate.message.includes('authorization_bundle_revisions_tenant_bundle_id_revision_number_unique')
  );
}

export async function ensureDraftBundleRevision(
  knex: Knex | Knex.Transaction,
  input: {
    tenant: string;
    bundleId: string;
    actorUserId?: string | null;
  }
): Promise<{ revisionId: string; created: boolean }> {
  return knex.transaction(async (trx) => {
    const scopedDb = tenantDb(trx, input.tenant);

    const bundle = await scopedDb.table('authorization_bundles')
      .where({
        bundle_id: input.bundleId,
      })
      .forUpdate()
      .first<{ published_revision_id: string | null; status: 'active' | 'archived' }>('published_revision_id', 'status');

    if (!bundle) {
      throw new Error('Bundle not found in tenant scope.');
    }

    if (bundle.status === 'archived') {
      throw new Error('Cannot create or retrieve drafts for an archived bundle.');
    }

    const existingDraft = await scopedDb.table('authorization_bundle_revisions')
      .where({
        bundle_id: input.bundleId,
        lifecycle_state: 'draft',
      })
      .orderBy('revision_number', 'desc')
      .first<{ revision_id: string }>('revision_id');

    if (existingDraft) {
      return { revisionId: existingDraft.revision_id, created: false };
    }

    const maxRevisionRow = await scopedDb.table('authorization_bundle_revisions')
      .where({
        bundle_id: input.bundleId,
      })
      .max<{ max_revision_number: string | null }>('revision_number as max_revision_number')
      .first();

    const nextRevisionNumber = Number(maxRevisionRow?.max_revision_number || 0) + 1;

    let draftRevision: { revision_id: string };
    try {
      [draftRevision] = await scopedDb.table('authorization_bundle_revisions')
        .insert({
          tenant: input.tenant,
          bundle_id: input.bundleId,
          revision_number: nextRevisionNumber,
          lifecycle_state: 'draft',
          created_by: input.actorUserId ?? null,
          updated_by: input.actorUserId ?? null,
        })
        .returning<{ revision_id: string }[]>('revision_id');
    } catch (error) {
      if (!isDraftRevisionUniquenessViolation(error) && !isRevisionNumberUniquenessViolation(error)) {
        throw error;
      }

      const concurrentDraft = await scopedDb.table('authorization_bundle_revisions')
        .where({
          bundle_id: input.bundleId,
          lifecycle_state: 'draft',
        })
        .orderBy('revision_number', 'desc')
        .first<{ revision_id: string }>('revision_id');

      if (!concurrentDraft) {
        throw error;
      }

      return { revisionId: concurrentDraft.revision_id, created: false };
    }

    if (!bundle.published_revision_id) {
      return { revisionId: draftRevision.revision_id, created: true };
    }

    const publishedRules = await scopedDb.table('authorization_bundle_rules')
      .where({
        revision_id: bundle.published_revision_id,
      })
      .orderBy('position', 'asc')
      .select<
        Array<{
          resource_type: string;
          action: string;
          template_key: string;
          constraint_key: string | null;
          config: Record<string, unknown>;
          position: number;
        }>
      >('resource_type', 'action', 'template_key', 'constraint_key', 'config', 'position');

    if (publishedRules.length > 0) {
      await scopedDb.table('authorization_bundle_rules').insert(
        publishedRules.map((rule) => ({
          tenant: input.tenant,
          bundle_id: input.bundleId,
          revision_id: draftRevision.revision_id,
          resource_type: rule.resource_type,
          action: rule.action,
          template_key: rule.template_key,
          effect: 'narrow',
          constraint_key: rule.constraint_key ?? null,
          config: rule.config ?? {},
          position: rule.position ?? 0,
          created_by: input.actorUserId ?? null,
        }))
      );
    }

    return { revisionId: draftRevision.revision_id, created: true };
  });
}

export async function listBundleRulesForRevision(
  knex: Knex | Knex.Transaction,
  input: {
    tenant: string;
    revisionId: string;
  }
): Promise<BundleRuleRecord[]> {
  const rows = await tenantDb(knex, input.tenant).table('authorization_bundle_rules')
    .where({
      revision_id: input.revisionId,
    })
    .orderBy('position', 'asc')
    .select<
      Array<{
        rule_id: string;
        resource_type: string;
        action: string;
        template_key: string;
        constraint_key: string | null;
        config: Record<string, unknown>;
        position: number;
      }>
    >('rule_id', 'resource_type', 'action', 'template_key', 'constraint_key', 'config', 'position');

  return rows.map((row) => ({
    ruleId: row.rule_id,
    resourceType: row.resource_type,
    action: row.action,
    templateKey: row.template_key,
    constraintKey: row.constraint_key ?? null,
    config: row.config ?? {},
    position: row.position ?? 0,
  }));
}

export async function deleteBundleRule(
  knex: Knex | Knex.Transaction,
  input: {
    tenant: string;
    bundleId: string;
    revisionId: string;
    ruleId: string;
  }
): Promise<void> {
  await knex.transaction(async (trx) => {
    const scopedDb = tenantDb(trx, input.tenant);

    const draftRevision = await scopedDb.table('authorization_bundle_revisions')
      .where({
        bundle_id: input.bundleId,
        revision_id: input.revisionId,
        lifecycle_state: 'draft',
      })
      .forUpdate()
      .first<{ revision_id: string }>('revision_id');

    if (!draftRevision) {
      throw new Error('Draft revision not found for bundle in tenant scope.');
    }

    const deleted = await scopedDb.table('authorization_bundle_rules')
      .where({
        bundle_id: input.bundleId,
        revision_id: input.revisionId,
        rule_id: input.ruleId,
      })
      .del();

    if (deleted === 0) {
      throw new Error('Rule not found in draft revision for bundle in tenant scope.');
    }
  });
}

export async function createAuthorizationBundle(
  knex: Knex | Knex.Transaction,
  input: CreateAuthorizationBundleInput
): Promise<{ bundleId: string; revisionId: string }> {
  ensureUuidLike(input.tenant, 'tenant');
  if (!input.name?.trim()) {
    throw new Error('Bundle name is required.');
  }

  const scopedDb = tenantDb(knex, input.tenant);

  const [bundle] = await scopedDb.table('authorization_bundles')
    .insert({
      tenant: input.tenant,
      bundle_key: input.bundleKey ?? null,
      name: input.name.trim(),
      description: input.description ?? null,
      is_system: input.isSystem ?? false,
      status: 'active',
      created_by: input.actorUserId ?? null,
      updated_by: input.actorUserId ?? null,
    })
    .returning<{ bundle_id: string }[]>('bundle_id');

  const [revision] = await scopedDb.table('authorization_bundle_revisions')
    .insert({
      tenant: input.tenant,
      bundle_id: bundle.bundle_id,
      revision_number: 1,
      lifecycle_state: 'draft',
      created_by: input.actorUserId ?? null,
      updated_by: input.actorUserId ?? null,
    })
    .returning<{ revision_id: string }[]>('revision_id');

  return { bundleId: bundle.bundle_id, revisionId: revision.revision_id };
}

export async function listAuthorizationBundles(
  knex: Knex | Knex.Transaction,
  input: {
    tenant: string;
    search?: string;
    includeArchived?: boolean;
  }
): Promise<AuthorizationBundleLibraryItem[]> {
  const scopedDb = tenantDb(knex, input.tenant);
  const query = scopedDb.table('authorization_bundles as b');
  scopedDb.tenantJoin(query, 'authorization_bundle_assignments as a', 'a.bundle_id', 'b.bundle_id', {
    type: 'left',
    on(join) {
      join
        .andOn(knex.raw("a.status = 'active'"));
    },
  })
    .groupBy([
      'b.bundle_id',
      'b.bundle_key',
      'b.name',
      'b.description',
      'b.is_system',
      'b.status',
      'b.published_revision_id',
      'b.updated_at',
    ])
    .orderBy('b.updated_at', 'desc')
    .select<
      Array<{
        bundle_id: string;
        bundle_key: string | null;
        name: string;
        description: string | null;
        is_system: boolean;
        status: 'active' | 'archived';
        published_revision_id: string | null;
        assignment_count: string;
        updated_at: string;
      }>
    >([
      'b.bundle_id',
      'b.bundle_key',
      'b.name',
      'b.description',
      'b.is_system',
      'b.status',
      'b.published_revision_id',
      'b.updated_at',
      knex.raw('count(a.assignment_id)::text as assignment_count'),
    ]);

  if (!input.includeArchived) {
    query.andWhere('b.status', 'active');
  }

  if (input.search?.trim()) {
    query.andWhere((builder) => {
      builder
        .whereILike('b.name', `%${input.search?.trim()}%`)
        .orWhereILike('b.description', `%${input.search?.trim()}%`);
    });
  }

  const rows = await query;
  return rows.map((row) => ({
    bundleId: row.bundle_id,
    bundleKey: row.bundle_key,
    name: row.name,
    description: row.description,
    isSystem: row.is_system,
    status: row.status,
    publishedRevisionId: row.published_revision_id,
    assignmentCount: Number(row.assignment_count || 0),
    updatedAt: row.updated_at,
  }));
}

export async function cloneAuthorizationBundle(
  knex: Knex,
  input: {
    tenant: string;
    sourceBundleId: string;
    name: string;
    actorUserId?: string | null;
  }
): Promise<{ bundleId: string; revisionId: string }> {
  ensureUuidLike(input.tenant, 'tenant');
  ensureUuidLike(input.sourceBundleId, 'sourceBundleId');
  if (!input.name?.trim()) {
    throw new Error('Clone name is required.');
  }

  return knex.transaction(async (trx) => {
    const scopedDb = tenantDb(trx, input.tenant);

    const sourceBundle = await scopedDb.table('authorization_bundles')
      .where({
        bundle_id: input.sourceBundleId,
      })
      .first<{
        bundle_id: string;
        description: string | null;
        published_revision_id: string | null;
      }>('bundle_id', 'description', 'published_revision_id');

    if (!sourceBundle) {
      throw new Error('Source bundle was not found in tenant scope.');
    }

    if (!sourceBundle.published_revision_id) {
      throw new Error('Cannot clone a bundle with no published revision. Publish the bundle first.');
    }

    const sourceRevision = await scopedDb.table('authorization_bundle_revisions')
      .where({
        revision_id: sourceBundle.published_revision_id,
      })
      .first<{ revision_id: string }>('revision_id');

    const created = await createAuthorizationBundle(trx, {
      tenant: input.tenant,
      name: input.name.trim(),
      description: sourceBundle.description,
      actorUserId: input.actorUserId ?? null,
    });

    if (!sourceRevision) {
      return created;
    }

    const sourceRules = await scopedDb.table('authorization_bundle_rules')
      .where({
        revision_id: sourceRevision.revision_id,
      })
      .orderBy('position', 'asc')
      .select<
        Array<{
          resource_type: string;
          action: string;
          template_key: string;
          constraint_key: string | null;
          config: Record<string, unknown>;
          position: number;
        }>
      >('resource_type', 'action', 'template_key', 'constraint_key', 'config', 'position');

    if (sourceRules.length === 0) {
      return created;
    }

    await scopedDb.table('authorization_bundle_rules').insert(
      sourceRules.map((rule) => ({
        tenant: input.tenant,
        bundle_id: created.bundleId,
        revision_id: created.revisionId,
        resource_type: rule.resource_type,
        action: rule.action,
        template_key: rule.template_key,
        effect: 'narrow',
        constraint_key: rule.constraint_key ?? null,
        config: rule.config ?? {},
        position: rule.position ?? 0,
        created_by: input.actorUserId ?? null,
      }))
    );

    return created;
  });
}

function ensureUuidLike(value: string, field: string): void {
  if (!value || typeof value !== 'string') {
    throw new Error(`${field} is required`);
  }
}

async function assertTargetExists(trx: Knex | Knex.Transaction, target: BundleAssignmentTarget): Promise<void> {
  const scopedDb = tenantDb(trx, target.tenant);

  switch (target.targetType) {
    case 'role': {
      const row = await scopedDb.table('roles')
        .where({ role_id: target.targetId })
        .first('role_id');
      if (!row) {
        throw new Error('Bundle assignment target role was not found in tenant scope.');
      }
      return;
    }
    case 'team': {
      const row = await scopedDb.table('teams')
        .where({ team_id: target.targetId })
        .first('team_id');
      if (!row) {
        throw new Error('Bundle assignment target team was not found in tenant scope.');
      }
      return;
    }
    case 'user': {
      const row = await scopedDb.table('users')
        .where({ user_id: target.targetId })
        .first('user_id');
      if (!row) {
        throw new Error('Bundle assignment target user was not found in tenant scope.');
      }
      return;
    }
    case 'api_key': {
      const row = await scopedDb.table('api_keys')
        .where({ api_key_id: target.targetId })
        .first('api_key_id');
      if (!row) {
        throw new Error('Bundle assignment target api key was not found in tenant scope.');
      }
      return;
    }
    default:
      throw new Error(`Unsupported assignment target type: ${(target as { targetType: string }).targetType}`);
  }
}

export async function createBundleAssignment(
  knex: Knex | Knex.Transaction,
  input: CreateBundleAssignmentInput
): Promise<void> {
  ensureUuidLike(input.tenant, 'tenant');
  ensureUuidLike(input.bundleId, 'bundleId');
  ensureUuidLike(input.targetId, 'targetId');

  await knex.transaction(async (trx) => {
    const scopedDb = tenantDb(trx, input.tenant);

    await assertTargetExists(trx, {
      tenant: input.tenant,
      targetType: input.targetType,
      targetId: input.targetId,
    });

    const bundle = await scopedDb.table('authorization_bundles')
      .where({
        bundle_id: input.bundleId,
      })
      .forUpdate()
      .first<{ bundle_id: string; status: 'active' | 'archived' }>('bundle_id', 'status');

    if (!bundle) {
      throw new Error('Bundle not found in tenant scope.');
    }

    if (bundle.status !== 'active') {
      throw new Error('Cannot create an active assignment for an archived bundle.');
    }

    await scopedDb.table('authorization_bundle_assignments')
      .insert({
        tenant: input.tenant,
        bundle_id: input.bundleId,
        target_type: input.targetType,
        target_id: input.targetId,
        status: 'active',
        created_by: input.actorUserId ?? null,
        updated_by: input.actorUserId ?? null,
      })
      .onConflict(['tenant', 'bundle_id', 'target_type', 'target_id'])
      .merge({
        status: 'active',
        updated_by: input.actorUserId ?? null,
        updated_at: new Date().toISOString(),
      });
  });
}

export async function setBundleAssignmentStatus(
  knex: Knex | Knex.Transaction,
  input: {
    tenant: string;
    assignmentId: string;
    status: 'active' | 'disabled';
    actorUserId?: string | null;
  }
): Promise<void> {
  await knex.transaction(async (trx) => {
    const scopedDb = tenantDb(trx, input.tenant);
    const assignmentQuery = scopedDb.table('authorization_bundle_assignments as a');
    const assignment = await scopedDb.tenantJoin(
      assignmentQuery,
      'authorization_bundles as b',
      'b.bundle_id',
      'a.bundle_id'
    )
      .andWhere('a.assignment_id', input.assignmentId)
      .forUpdate()
      .first<{
        assignment_id: string;
        bundle_status: 'active' | 'archived';
      }>('a.assignment_id', 'b.status as bundle_status');

    if (!assignment) {
      throw new Error('Bundle assignment not found in tenant scope.');
    }

    if (input.status === 'active' && assignment.bundle_status !== 'active') {
      throw new Error('Cannot activate an assignment for an archived bundle.');
    }

    await scopedDb.table('authorization_bundle_assignments')
      .where({
        assignment_id: input.assignmentId,
      })
      .update({
        status: input.status,
        updated_by: input.actorUserId ?? null,
        updated_at: trx.fn.now(),
      });
  });
}

export async function archiveBundle(
  knex: Knex | Knex.Transaction,
  input: {
    tenant: string;
    bundleId: string;
    actorUserId?: string | null;
  }
): Promise<void> {
  await knex.transaction(async (trx) => {
    const scopedDb = tenantDb(trx, input.tenant);

    const bundle = await scopedDb.table('authorization_bundles')
      .where({
        bundle_id: input.bundleId,
      })
      .forUpdate()
      .first<{ bundle_id: string }>('bundle_id');

    if (!bundle) {
      throw new Error('Bundle not found in tenant scope.');
    }

    await scopedDb.table('authorization_bundles')
      .where({
        bundle_id: input.bundleId,
      })
      .update({
        status: 'archived',
        updated_by: input.actorUserId ?? null,
        updated_at: trx.fn.now(),
      });

    await scopedDb.table('authorization_bundle_assignments')
      .where({
        bundle_id: input.bundleId,
        status: 'active',
      })
      .update({
        status: 'disabled',
        updated_by: input.actorUserId ?? null,
        updated_at: trx.fn.now(),
      });
  });
}

export async function publishBundleRevision(
  knex: Knex | Knex.Transaction,
  input: PublishBundleRevisionInput
): Promise<void> {
  await knex.transaction(async (trx) => {
    const scopedDb = tenantDb(trx, input.tenant);

    const bundle = await scopedDb.table('authorization_bundles')
      .where({
        bundle_id: input.bundleId,
      })
      .forUpdate()
      .first<{ bundle_id: string; published_revision_id: string | null; status: 'active' | 'archived' }>('bundle_id', 'published_revision_id', 'status');

    if (!bundle) {
      throw new Error('Bundle not found in tenant scope.');
    }

    if (bundle.status === 'archived') {
      throw new Error('Cannot publish revisions for an archived bundle.');
    }

    const revision = await scopedDb.table('authorization_bundle_revisions')
      .where({
        bundle_id: input.bundleId,
        revision_id: input.revisionId,
      })
      .forUpdate()
      .first<{ revision_id: string; lifecycle_state: string }>('revision_id', 'lifecycle_state');

    if (!revision) {
      throw new Error('Revision not found for bundle in tenant scope.');
    }

    if (revision.lifecycle_state !== 'draft') {
      throw new Error('Only draft revisions can be published. Refresh bundle state and try again.');
    }

    const draftRuleCountRow = await scopedDb.table('authorization_bundle_rules')
      .where({
        bundle_id: input.bundleId,
        revision_id: input.revisionId,
      })
      .count<{ count: string }>('rule_id as count')
      .first();

    if (Number(draftRuleCountRow?.count || 0) === 0) {
      throw new Error(
        'Cannot publish an empty draft revision. Add at least one narrowing rule before publishing.'
      );
    }

    if (bundle.published_revision_id) {
      await scopedDb.table('authorization_bundle_revisions')
        .where({
          bundle_id: input.bundleId,
          revision_id: bundle.published_revision_id,
          lifecycle_state: 'published',
        })
        .update({
          lifecycle_state: 'archived',
          updated_by: input.actorUserId ?? null,
          updated_at: trx.fn.now(),
        });
    }

    const published = await scopedDb.table('authorization_bundle_revisions')
      .where({
        bundle_id: input.bundleId,
        revision_id: input.revisionId,
        lifecycle_state: 'draft',
      })
      .update({
        lifecycle_state: 'published',
        published_at: trx.fn.now(),
        published_by: input.actorUserId ?? null,
        updated_by: input.actorUserId ?? null,
        updated_at: trx.fn.now(),
      });

    if (published === 0) {
      throw new Error('Draft revision changed before publish could complete. Refresh bundle state and try again.');
    }

    await scopedDb.table('authorization_bundles')
      .where({
        bundle_id: input.bundleId,
      })
      .update({
        published_revision_id: input.revisionId,
        status: 'active',
        updated_by: input.actorUserId ?? null,
        updated_at: trx.fn.now(),
      });
  });
}

export async function upsertBundleRule(
  knex: Knex | Knex.Transaction,
  input: UpsertBundleRuleInput
): Promise<void> {
  assertBundleRuleCatalogInput({
    templateKey: input.templateKey,
    constraintKey: input.constraintKey ?? null,
  });

  await knex.transaction(async (trx) => {
    const scopedDb = tenantDb(trx, input.tenant);

    const draftRevision = await scopedDb.table('authorization_bundle_revisions')
      .where({
        bundle_id: input.bundleId,
        revision_id: input.revisionId,
        lifecycle_state: 'draft',
      })
      .forUpdate()
      .first<{ revision_id: string }>('revision_id');

    if (!draftRevision) {
      throw new Error('Draft revision not found for bundle in tenant scope.');
    }

    const basePayload = {
      tenant: input.tenant,
      bundle_id: input.bundleId,
      revision_id: input.revisionId,
      resource_type: input.resourceType,
      action: input.action,
      template_key: input.templateKey,
      effect: 'narrow',
      constraint_key: input.constraintKey ?? null,
      config: input.config ?? {},
      updated_at: trx.fn.now(),
    };

    if (input.ruleId) {
      const updatePayload: Record<string, unknown> = { ...basePayload };
      if (typeof input.position === 'number') {
        updatePayload.position = input.position;
      }

      const updated = await scopedDb.table('authorization_bundle_rules')
        .where({
          bundle_id: input.bundleId,
          revision_id: input.revisionId,
          rule_id: input.ruleId,
        })
        .update(updatePayload);

      if (updated === 0) {
        throw new Error('Rule not found in draft revision for bundle in tenant scope.');
      }
      return;
    }

    await scopedDb.table('authorization_bundle_rules').insert({
      ...basePayload,
      position: input.position ?? 0,
      created_by: input.actorUserId ?? null,
    });
  });
}

async function resolveRoleIdsForUser(
  knex: Knex | Knex.Transaction,
  tenant: string,
  userId: string
): Promise<string[]> {
  const rows = await tenantDb(knex, tenant).table('user_roles')
    .where({ user_id: userId })
    .select<{ role_id: string }[]>('role_id');
  return rows.map((row) => row.role_id);
}

async function resolveTeamIdsForUser(
  knex: Knex | Knex.Transaction,
  tenant: string,
  userId: string
): Promise<string[]> {
  const rows = await tenantDb(knex, tenant).table('team_members')
    .where({ user_id: userId })
    .select<{ team_id: string }[]>('team_id');
  return rows.map((row) => row.team_id);
}

function emptyRuleSet(): BundleNarrowingRule[] {
  return [];
}

function normalizeRuleIdList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = [
    ...new Set(
      value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0)
    ),
  ];

  return normalized.length > 0 ? normalized : [];
}

export async function resolveBundleNarrowingRulesForEvaluation(
  knex: Knex | Knex.Transaction,
  input: AuthorizationEvaluationInput
): Promise<BundleNarrowingRule[]> {
  const tenant = input.subject.tenant;
  const userId = input.subject.userId;

  if (!tenant || !userId) {
    return emptyRuleSet();
  }

  const [roleIds, teamIds] = await Promise.all([
    resolveRoleIdsForUser(knex, tenant, userId),
    resolveTeamIdsForUser(knex, tenant, userId),
  ]);

  const targetClauses: Array<{ target_type: AuthorizationBundleTargetType; ids: string[] }> = [
    { target_type: 'user', ids: [userId] },
    { target_type: 'role', ids: roleIds },
    { target_type: 'team', ids: teamIds },
  ];

  if (input.subject.apiKeyId) {
    targetClauses.push({ target_type: 'api_key', ids: [input.subject.apiKeyId] });
  }

  const scopedDb = tenantDb(knex, tenant);
  const assignmentsQuery = scopedDb.table('authorization_bundle_assignments as a');
  const assignments = await scopedDb.tenantJoin(
    assignmentsQuery,
    'authorization_bundles as b',
    'b.bundle_id',
    'a.bundle_id'
  )
    .andWhere('a.status', 'active')
    .andWhere('b.status', 'active')
    .whereNotNull('b.published_revision_id')
    .andWhere((builder) => {
      for (const clause of targetClauses) {
        if (clause.ids.length === 0) {
          continue;
        }
        builder.orWhere((subBuilder) => {
          subBuilder.where('a.target_type', clause.target_type).whereIn('a.target_id', clause.ids);
        });
      }
    })
    .select<
      Array<{
        bundle_id: string;
        revision_id: string;
      }>
    >('a.bundle_id', 'b.published_revision_id as revision_id');

  const revisionIds = [
    ...new Set(
      assignments
        .map((assignment) => assignment.revision_id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    ),
  ];
  if (revisionIds.length === 0) {
    return emptyRuleSet();
  }

  const rules = await scopedDb.table('authorization_bundle_rules')
    .whereIn('revision_id', revisionIds)
    .select<
      Array<{
        rule_id: string;
        resource_type: string;
        action: string;
        template_key: string;
        constraint_key: string | null;
        config: Record<string, unknown>;
      }>
    >('rule_id', 'resource_type', 'action', 'template_key', 'constraint_key', 'config');

  return rules.map((rule) => ({
    id: rule.rule_id,
    resource: rule.resource_type,
    action: rule.action,
    templateKey: rule.template_key as RelationshipTemplateKey,
    constraintKey: rule.constraint_key ?? null,
    constraints: Array.isArray(rule.config?.constraints)
      ? (rule.config.constraints as BundleNarrowingRule['constraints'])
      : [],
    redactedFields: Array.isArray(rule.config?.redactedFields)
      ? (rule.config.redactedFields as string[])
      : [],
    selectedClientIds:
      normalizeRuleIdList(rule.config?.selectedClientIds) ??
      normalizeRuleIdList(rule.config?.selected_client_ids),
    selectedBoardIds:
      normalizeRuleIdList(rule.config?.selectedBoardIds) ??
      normalizeRuleIdList(rule.config?.selected_board_ids),
  }));
}
