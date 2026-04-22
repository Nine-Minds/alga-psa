import type { Knex } from 'knex';
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

export async function ensureDraftBundleRevision(
  knex: Knex | Knex.Transaction,
  input: {
    tenant: string;
    bundleId: string;
    actorUserId?: string | null;
  }
): Promise<{ revisionId: string; created: boolean }> {
  const existingDraft = await knex('authorization_bundle_revisions')
    .where({
      tenant: input.tenant,
      bundle_id: input.bundleId,
      lifecycle_state: 'draft',
    })
    .orderBy('revision_number', 'desc')
    .first<{ revision_id: string }>('revision_id');

  if (existingDraft) {
    return { revisionId: existingDraft.revision_id, created: false };
  }

  const bundle = await knex('authorization_bundles')
    .where({
      tenant: input.tenant,
      bundle_id: input.bundleId,
    })
    .first<{ published_revision_id: string | null }>('published_revision_id');

  if (!bundle) {
    throw new Error('Bundle not found in tenant scope.');
  }

  const maxRevisionRow = await knex('authorization_bundle_revisions')
    .where({
      tenant: input.tenant,
      bundle_id: input.bundleId,
    })
    .max<{ max_revision_number: string | null }>('revision_number as max_revision_number')
    .first();

  const nextRevisionNumber = Number(maxRevisionRow?.max_revision_number || 0) + 1;

  const [draftRevision] = await knex('authorization_bundle_revisions')
    .insert({
      tenant: input.tenant,
      bundle_id: input.bundleId,
      revision_number: nextRevisionNumber,
      lifecycle_state: 'draft',
      created_by: input.actorUserId ?? null,
      updated_by: input.actorUserId ?? null,
    })
    .returning<{ revision_id: string }[]>('revision_id');

  if (!bundle.published_revision_id) {
    return { revisionId: draftRevision.revision_id, created: true };
  }

  const publishedRules = await knex('authorization_bundle_rules')
    .where({
      tenant: input.tenant,
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
    await knex('authorization_bundle_rules').insert(
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
}

export async function listBundleRulesForRevision(
  knex: Knex | Knex.Transaction,
  input: {
    tenant: string;
    revisionId: string;
  }
): Promise<BundleRuleRecord[]> {
  const rows = await knex('authorization_bundle_rules')
    .where({
      tenant: input.tenant,
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
  const deleted = await knex('authorization_bundle_rules')
    .where({
      tenant: input.tenant,
      bundle_id: input.bundleId,
      revision_id: input.revisionId,
      rule_id: input.ruleId,
    })
    .del();

  if (deleted === 0) {
    throw new Error('Rule not found in draft revision for bundle in tenant scope.');
  }
}

export async function createAuthorizationBundle(
  knex: Knex | Knex.Transaction,
  input: CreateAuthorizationBundleInput
): Promise<{ bundleId: string; revisionId: string }> {
  ensureUuidLike(input.tenant, 'tenant');
  if (!input.name?.trim()) {
    throw new Error('Bundle name is required.');
  }

  const [bundle] = await knex('authorization_bundles')
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

  const [revision] = await knex('authorization_bundle_revisions')
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
  const query = knex('authorization_bundles as b')
    .leftJoin('authorization_bundle_assignments as a', function joinAssignments() {
      this.on('a.tenant', '=', 'b.tenant')
        .andOn('a.bundle_id', '=', 'b.bundle_id')
        .andOn(knex.raw("a.status = 'active'"));
    })
    .where('b.tenant', input.tenant)
    .groupBy('b.bundle_id')
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
    const sourceBundle = await trx('authorization_bundles')
      .where({
        tenant: input.tenant,
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

    const sourceRevision = sourceBundle.published_revision_id
      ? await trx('authorization_bundle_revisions')
          .where({
            tenant: input.tenant,
            revision_id: sourceBundle.published_revision_id,
          })
          .first<{ revision_id: string }>('revision_id')
      : await trx('authorization_bundle_revisions')
          .where({
            tenant: input.tenant,
            bundle_id: sourceBundle.bundle_id,
          })
          .orderBy('revision_number', 'desc')
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

    const sourceRules = await trx('authorization_bundle_rules')
      .where({
        tenant: input.tenant,
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

    await trx('authorization_bundle_rules').insert(
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
  switch (target.targetType) {
    case 'role': {
      const row = await trx('roles')
        .where({ tenant: target.tenant, role_id: target.targetId })
        .first('role_id');
      if (!row) {
        throw new Error('Bundle assignment target role was not found in tenant scope.');
      }
      return;
    }
    case 'team': {
      const row = await trx('teams')
        .where({ tenant: target.tenant, team_id: target.targetId })
        .first('team_id');
      if (!row) {
        throw new Error('Bundle assignment target team was not found in tenant scope.');
      }
      return;
    }
    case 'user': {
      const row = await trx('users')
        .where({ tenant: target.tenant, user_id: target.targetId })
        .first('user_id');
      if (!row) {
        throw new Error('Bundle assignment target user was not found in tenant scope.');
      }
      return;
    }
    case 'api_key': {
      const row = await trx('api_keys')
        .where({ tenant: target.tenant, api_key_id: target.targetId })
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

  await assertTargetExists(knex, {
    tenant: input.tenant,
    targetType: input.targetType,
    targetId: input.targetId,
  });

  await knex('authorization_bundle_assignments')
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
      updated_at: knex.fn.now(),
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
  await knex('authorization_bundle_assignments')
    .where({
      tenant: input.tenant,
      assignment_id: input.assignmentId,
    })
    .update({
      status: input.status,
      updated_by: input.actorUserId ?? null,
      updated_at: knex.fn.now(),
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
  await knex('authorization_bundles')
    .where({
      tenant: input.tenant,
      bundle_id: input.bundleId,
    })
    .update({
      status: 'archived',
      updated_by: input.actorUserId ?? null,
      updated_at: knex.fn.now(),
    });
}

export async function publishBundleRevision(
  knex: Knex | Knex.Transaction,
  input: PublishBundleRevisionInput
): Promise<void> {
  await knex.transaction(async (trx) => {
    const revision = await trx('authorization_bundle_revisions')
      .where({
        tenant: input.tenant,
        bundle_id: input.bundleId,
        revision_id: input.revisionId,
      })
      .first('revision_id');

    if (!revision) {
      throw new Error('Revision not found for bundle in tenant scope.');
    }

    await trx('authorization_bundle_revisions')
      .where({
        tenant: input.tenant,
        bundle_id: input.bundleId,
        lifecycle_state: 'published',
      })
      .update({
        lifecycle_state: 'archived',
        updated_by: input.actorUserId ?? null,
        updated_at: trx.fn.now(),
      });

    await trx('authorization_bundle_revisions')
      .where({
        tenant: input.tenant,
        revision_id: input.revisionId,
      })
      .update({
        lifecycle_state: 'published',
        published_at: trx.fn.now(),
        published_by: input.actorUserId ?? null,
        updated_by: input.actorUserId ?? null,
        updated_at: trx.fn.now(),
      });

    await trx('authorization_bundles')
      .where({
        tenant: input.tenant,
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

  const draftRevision = await knex('authorization_bundle_revisions')
    .where({
      tenant: input.tenant,
      bundle_id: input.bundleId,
      revision_id: input.revisionId,
      lifecycle_state: 'draft',
    })
    .first<{ revision_id: string }>('revision_id');

  if (!draftRevision) {
    throw new Error('Draft revision not found for bundle in tenant scope.');
  }

  const payload = {
    tenant: input.tenant,
    bundle_id: input.bundleId,
    revision_id: input.revisionId,
    resource_type: input.resourceType,
    action: input.action,
    template_key: input.templateKey,
    effect: 'narrow',
    constraint_key: input.constraintKey ?? null,
    config: input.config ?? {},
    position: input.position ?? 0,
    created_by: input.actorUserId ?? null,
    updated_at: knex.fn.now(),
  };

  if (input.ruleId) {
    const updated = await knex('authorization_bundle_rules')
      .where({
        tenant: input.tenant,
        bundle_id: input.bundleId,
        revision_id: input.revisionId,
        rule_id: input.ruleId,
      })
      .update(payload);

    if (updated === 0) {
      throw new Error('Rule not found in draft revision for bundle in tenant scope.');
    }
    return;
  }

  await knex('authorization_bundle_rules').insert(payload);
}

async function resolveRoleIdsForUser(
  knex: Knex | Knex.Transaction,
  tenant: string,
  userId: string
): Promise<string[]> {
  const rows = await knex('user_roles')
    .where({ tenant, user_id: userId })
    .select<{ role_id: string }[]>('role_id');
  return rows.map((row) => row.role_id);
}

async function resolveTeamIdsForUser(
  knex: Knex | Knex.Transaction,
  tenant: string,
  userId: string
): Promise<string[]> {
  const rows = await knex('team_members')
    .where({ tenant, user_id: userId })
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

  const assignments = await knex('authorization_bundle_assignments as a')
    .join('authorization_bundles as b', function joinBundle() {
      this.on('b.tenant', '=', 'a.tenant').andOn('b.bundle_id', '=', 'a.bundle_id');
    })
    .where('a.tenant', tenant)
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

  const rules = await knex('authorization_bundle_rules')
    .where({ tenant })
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
