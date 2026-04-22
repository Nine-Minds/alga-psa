import type { Knex } from 'knex';
import type { AuthorizationEvaluationInput } from '../kernel';
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
  knex: Knex,
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
    await knex('authorization_bundle_rules')
      .where({
        tenant: input.tenant,
        rule_id: input.ruleId,
      })
      .update(payload);
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
        constraint_key: string | null;
        config: Record<string, unknown>;
      }>
    >('rule_id', 'resource_type', 'action', 'constraint_key', 'config');

  return rules.map((rule) => ({
    id: rule.rule_id,
    resource: rule.resource_type,
    action: rule.action,
    constraintKey: rule.constraint_key ?? null,
    constraints: Array.isArray(rule.config?.constraints)
      ? (rule.config.constraints as BundleNarrowingRule['constraints'])
      : [],
    redactedFields: Array.isArray(rule.config?.redactedFields)
      ? (rule.config.redactedFields as string[])
      : [],
  }));
}
