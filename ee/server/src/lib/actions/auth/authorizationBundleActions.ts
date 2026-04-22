'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { TIER_FEATURES } from '@alga-psa/types';
import { createTenantKnex } from '@/lib/db';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import {
  type AuthorizationRecord,
  type AuthorizationReason,
  type RelationshipTemplateKey,
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  createAuthorizationKernel,
} from 'server/src/lib/authorization/kernel';
import type { BundleNarrowingRule } from 'server/src/lib/authorization/kernel/providers/bundleProvider';
import {
  archiveBundle,
  cloneAuthorizationBundle,
  createBundleAssignment,
  deleteBundleRule,
  createAuthorizationBundle,
  ensureDraftBundleRevision,
  listBundleRulesForRevision,
  listAuthorizationBundles,
  publishBundleRevision,
  setBundleAssignmentStatus,
  upsertBundleRule,
} from 'server/src/lib/authorization/bundles/service';
import { STARTER_AUTHORIZATION_BUNDLES } from 'server/src/lib/authorization/bundles/starterBundles';
import { AUTHORIZATION_TEMPLATE_CATALOG, AUTHORIZATION_CONSTRAINT_CATALOG } from 'server/src/lib/authorization/bundles/catalog';

export interface AuthorizationBundleLibraryEntry {
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

export interface AuthorizationBundleDraftEditorPayload {
  bundle: {
    bundleId: string;
    name: string;
    description: string | null;
    publishedRevisionId: string | null;
  };
  draftRevisionId: string;
  rules: Array<{
    ruleId: string;
    resourceType: string;
    action: string;
    templateKey: string;
    constraintKey: string | null;
    config: Record<string, unknown>;
    position: number;
  }>;
  availableTemplates: string[];
  availableConstraints: string[];
  revisionChangeSummary: string;
}

export interface AuthorizationBundleAssignmentViewerPayload {
  bundleId: string;
  assignments: Array<{
    assignmentId: string;
    targetType: 'role' | 'team' | 'user' | 'api_key';
    targetId: string;
    targetLabel: string;
    status: 'active' | 'disabled';
  }>;
}

export interface AuthorizationSimulationOption {
  id: string;
  label: string;
}

export interface AuthorizationSimulationDecision {
  allowed: boolean;
  reasonCodes: string[];
}

export interface AuthorizationBundleSimulationPayload {
  draft: AuthorizationSimulationDecision;
  published: AuthorizationSimulationDecision;
}

const SUPPORTED_SIMULATION_ACTIONS = new Set(['read', 'approve']);

export interface AuthorizationBundleAuditEvent {
  eventType:
    | 'bundle_created'
    | 'bundle_archived'
    | 'revision_drafted'
    | 'revision_published'
    | 'assignment_created'
    | 'assignment_updated';
  occurredAt: string;
  actorUserId: string | null;
  metadata: Record<string, unknown>;
}

export const createAuthorizationBundleAction = withAuth(
  async (
    user,
    { tenant },
    input: { name: string; description?: string | null }
  ): Promise<{ bundleId: string }> => {
    await assertTierAccess(TIER_FEATURES.ADVANCED_AUTHORIZATION_BUNDLES);
    await assertSecuritySettingsPermission(user, 'write');

    const { knex } = await createTenantKnex();
    const created = await createAuthorizationBundle(knex, {
      tenant,
      name: input.name,
      description: input.description ?? null,
      actorUserId: user.user_id,
    });

    return { bundleId: created.bundleId };
  }
);

async function assertSecuritySettingsPermission(user: unknown, action: 'read' | 'write'): Promise<void> {
  const allowed = await hasPermission(user as any, 'system_settings', action);
  if (!allowed) {
    throw new Error('You do not have permission to manage authorization bundles.');
  }
}

export const listAuthorizationBundlesAction = withAuth(
  async (
    user,
    { tenant },
    input?: {
      search?: string;
      includeArchived?: boolean;
    }
  ): Promise<AuthorizationBundleLibraryEntry[]> => {
    await assertTierAccess(TIER_FEATURES.ADVANCED_AUTHORIZATION_BUNDLES);
    await assertSecuritySettingsPermission(user, 'read');

    const { knex } = await createTenantKnex();
    return listAuthorizationBundles(knex, {
      tenant,
      search: input?.search,
      includeArchived: input?.includeArchived,
    });
  }
);

export const seedStarterAuthorizationBundlesAction = withAuth(
  async (user, { tenant }): Promise<void> => {
    await assertTierAccess(TIER_FEATURES.ADVANCED_AUTHORIZATION_BUNDLES);
    await assertSecuritySettingsPermission(user, 'write');

    const { knex } = await createTenantKnex();

    await knex.transaction(async (trx) => {
      for (const starter of STARTER_AUTHORIZATION_BUNDLES) {
        const existing = await trx('authorization_bundles')
          .where({
            tenant,
            bundle_key: starter.key,
          })
          .first('bundle_id');

        if (existing) {
          continue;
        }

        const created = await createAuthorizationBundle(trx, {
          tenant,
          name: starter.name,
          description: starter.description,
          bundleKey: starter.key,
          isSystem: true,
          actorUserId: user.user_id,
        });

        for (const [index, rule] of starter.rules.entries()) {
          await upsertBundleRule(trx, {
            tenant,
            bundleId: created.bundleId,
            revisionId: created.revisionId,
            resourceType: rule.resourceType,
            action: rule.action,
            templateKey: rule.templateKey,
            constraintKey: rule.constraintKey ?? null,
            config: rule.config ?? {},
            position: index,
            actorUserId: user.user_id,
          });
        }

        await publishBundleRevision(trx, {
          tenant,
          bundleId: created.bundleId,
          revisionId: created.revisionId,
          actorUserId: user.user_id,
        });
      }
    });
  }
);

export const cloneAuthorizationBundleAction = withAuth(
  async (
    user,
    { tenant },
    input: {
      sourceBundleId: string;
      name: string;
    }
  ): Promise<void> => {
    await assertTierAccess(TIER_FEATURES.ADVANCED_AUTHORIZATION_BUNDLES);
    await assertSecuritySettingsPermission(user, 'write');

    const { knex } = await createTenantKnex();
    await cloneAuthorizationBundle(knex, {
      tenant,
      sourceBundleId: input.sourceBundleId,
      name: input.name,
      actorUserId: user.user_id,
    });
  }
);

export const archiveAuthorizationBundleAction = withAuth(
  async (user, { tenant }, bundleId: string): Promise<void> => {
    await assertTierAccess(TIER_FEATURES.ADVANCED_AUTHORIZATION_BUNDLES);
    await assertSecuritySettingsPermission(user, 'write');

    const { knex } = await createTenantKnex();
    await archiveBundle(knex, {
      tenant,
      bundleId,
      actorUserId: user.user_id,
    });
  }
);

export const getAuthorizationBundleDraftEditorAction = withAuth(
  async (user, { tenant }, bundleId: string): Promise<AuthorizationBundleDraftEditorPayload> => {
    await assertTierAccess(TIER_FEATURES.ADVANCED_AUTHORIZATION_BUNDLES);
    await assertSecuritySettingsPermission(user, 'read');

    const { knex } = await createTenantKnex();
    const bundle = await knex('authorization_bundles')
      .where({
        tenant,
        bundle_id: bundleId,
      })
      .first<{
        bundle_id: string;
        name: string;
        description: string | null;
        published_revision_id: string | null;
      }>('bundle_id', 'name', 'description', 'published_revision_id');

    if (!bundle) {
      throw new Error('Bundle not found in tenant scope.');
    }

    const canWrite = await hasPermission(user as any, 'system_settings', 'write');

    const draftRevisionId = canWrite
      ? (
          await ensureDraftBundleRevision(knex, {
            tenant,
            bundleId,
            actorUserId: user.user_id,
          })
        ).revisionId
      : (
          await knex('authorization_bundle_revisions')
            .where({
              tenant,
              bundle_id: bundleId,
              lifecycle_state: 'draft',
            })
            .orderBy('revision_number', 'desc')
            .first<{ revision_id: string }>('revision_id')
        )?.revision_id ?? bundle.published_revision_id;

    if (!draftRevisionId) {
      throw new Error('Draft or published revision not found for bundle in tenant scope.');
    }

    const rules = await listBundleRulesForRevision(knex, {
      tenant,
      revisionId: draftRevisionId,
    });

    const publishedRules = bundle.published_revision_id
      ? await listBundleRulesForRevision(knex, {
          tenant,
          revisionId: bundle.published_revision_id,
        })
      : [];

    const fingerprint = (rule: {
      resourceType: string;
      action: string;
      templateKey: string;
      constraintKey: string | null;
      config: Record<string, unknown>;
    }) =>
      JSON.stringify([
        rule.resourceType,
        rule.action,
        rule.templateKey,
        rule.constraintKey ?? '',
        JSON.stringify(rule.config ?? {}),
      ]);

    const draftRuleSet = new Set(rules.map(fingerprint));
    const publishedRuleSet = new Set(publishedRules.map(fingerprint));

    let addedCount = 0;
    for (const item of draftRuleSet) {
      if (!publishedRuleSet.has(item)) {
        addedCount += 1;
      }
    }

    let removedCount = 0;
    for (const item of publishedRuleSet) {
      if (!draftRuleSet.has(item)) {
        removedCount += 1;
      }
    }

    const revisionChangeSummary = bundle.published_revision_id
      ? draftRevisionId === bundle.published_revision_id
        ? `Published has ${rules.length} rule(s). No active draft revision in tenant scope.`
        : `Draft has ${rules.length} rule(s): ${addedCount} added, ${removedCount} removed versus published.`
      : `Draft has ${rules.length} rule(s). No published revision yet.`;

    return {
      bundle: {
        bundleId: bundle.bundle_id,
        name: bundle.name,
        description: bundle.description,
        publishedRevisionId: bundle.published_revision_id,
      },
      draftRevisionId,
      rules,
      availableTemplates: [...AUTHORIZATION_TEMPLATE_CATALOG],
      availableConstraints: [...AUTHORIZATION_CONSTRAINT_CATALOG],
      revisionChangeSummary,
    };
  }
);

export const upsertAuthorizationBundleDraftRuleAction = withAuth(
  async (
    user,
    { tenant },
    input: {
      bundleId: string;
      ruleId?: string;
      resourceType: string;
      action: string;
      templateKey: string;
      constraintKey?: string | null;
      config?: Record<string, unknown>;
    }
  ): Promise<void> => {
    await assertTierAccess(TIER_FEATURES.ADVANCED_AUTHORIZATION_BUNDLES);
    await assertSecuritySettingsPermission(user, 'write');

    const { knex } = await createTenantKnex();
    const draft = await ensureDraftBundleRevision(knex, {
      tenant,
      bundleId: input.bundleId,
      actorUserId: user.user_id,
    });

    const existingRules = await listBundleRulesForRevision(knex, {
      tenant,
      revisionId: draft.revisionId,
    });
    const nextPosition = input.ruleId ? 0 : existingRules.length;

    await upsertBundleRule(knex, {
      tenant,
      bundleId: input.bundleId,
      revisionId: draft.revisionId,
      ruleId: input.ruleId,
      resourceType: input.resourceType,
      action: input.action,
      templateKey: input.templateKey,
      constraintKey: input.constraintKey ?? null,
      config: input.config ?? {},
      position: nextPosition,
      actorUserId: user.user_id,
    });
  }
);

export const deleteAuthorizationBundleDraftRuleAction = withAuth(
  async (user, { tenant }, input: { bundleId: string; ruleId: string }): Promise<void> => {
    await assertTierAccess(TIER_FEATURES.ADVANCED_AUTHORIZATION_BUNDLES);
    await assertSecuritySettingsPermission(user, 'write');

    const { knex } = await createTenantKnex();
    const draft = await ensureDraftBundleRevision(knex, {
      tenant,
      bundleId: input.bundleId,
      actorUserId: user.user_id,
    });

    await deleteBundleRule(knex, {
      tenant,
      bundleId: input.bundleId,
      revisionId: draft.revisionId,
      ruleId: input.ruleId,
    });
  }
);

export const listAuthorizationBundleAssignmentsAction = withAuth(
  async (user, { tenant }, bundleId: string): Promise<AuthorizationBundleAssignmentViewerPayload> => {
    await assertTierAccess(TIER_FEATURES.ADVANCED_AUTHORIZATION_BUNDLES);
    await assertSecuritySettingsPermission(user, 'read');

    const { knex } = await createTenantKnex();
    const assignments = await knex('authorization_bundle_assignments')
      .where({
        tenant,
        bundle_id: bundleId,
      })
      .orderBy('created_at', 'asc')
      .select<
        Array<{
          assignment_id: string;
          target_type: 'role' | 'team' | 'user' | 'api_key';
          target_id: string;
          status: 'active' | 'disabled';
        }>
      >('assignment_id', 'target_type', 'target_id', 'status');

    const roleIds = assignments
      .filter((assignment) => assignment.target_type === 'role')
      .map((assignment) => assignment.target_id);
    const teamIds = assignments
      .filter((assignment) => assignment.target_type === 'team')
      .map((assignment) => assignment.target_id);
    const userIds = assignments
      .filter((assignment) => assignment.target_type === 'user')
      .map((assignment) => assignment.target_id);
    const apiKeyIds = assignments
      .filter((assignment) => assignment.target_type === 'api_key')
      .map((assignment) => assignment.target_id);

    const [roles, teams, users, apiKeys] = await Promise.all([
      roleIds.length > 0
        ? knex('roles').where({ tenant }).whereIn('role_id', roleIds).select<{ role_id: string; role_name: string }[]>('role_id', 'role_name')
        : Promise.resolve([]),
      teamIds.length > 0
        ? knex('teams').where({ tenant }).whereIn('team_id', teamIds).select<{ team_id: string; team_name: string }[]>('team_id', 'team_name')
        : Promise.resolve([]),
      userIds.length > 0
        ? knex('users').where({ tenant }).whereIn('user_id', userIds).select<{ user_id: string; first_name: string | null; last_name: string | null; username: string | null; email: string | null }[]>('user_id', 'first_name', 'last_name', 'username', 'email')
        : Promise.resolve([]),
      apiKeyIds.length > 0
        ? knex('api_keys').where({ tenant }).whereIn('api_key_id', apiKeyIds).select<{ api_key_id: string; key_name: string | null; description: string | null }[]>('api_key_id', 'key_name', 'description')
        : Promise.resolve([]),
    ]);

    const roleNameById = new Map(roles.map((row) => [row.role_id, row.role_name]));
    const teamNameById = new Map(teams.map((row) => [row.team_id, row.team_name]));
    const userNameById = new Map(
      users.map((row) => [
        row.user_id,
        [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.username || row.email || 'Unknown user',
      ])
    );
    const apiKeyNameById = new Map(
      apiKeys.map((row) => [row.api_key_id, row.key_name || row.description || 'Unnamed API key'])
    );

    return {
      bundleId,
      assignments: assignments.map((assignment) => {
        const targetLabel =
          assignment.target_type === 'role'
            ? roleNameById.get(assignment.target_id) ?? 'Unknown role'
            : assignment.target_type === 'team'
              ? teamNameById.get(assignment.target_id) ?? 'Unknown team'
              : assignment.target_type === 'user'
                ? userNameById.get(assignment.target_id) ?? 'Unknown user'
                : apiKeyNameById.get(assignment.target_id) ?? 'Unknown API key';

        return {
          assignmentId: assignment.assignment_id,
          targetType: assignment.target_type,
          targetId: assignment.target_id,
          targetLabel,
          status: assignment.status,
        };
      }),
    };
  }
);

export const listAuthorizationSimulationPrincipalsAction = withAuth(
  async (user, { tenant }): Promise<AuthorizationSimulationOption[]> => {
    await assertTierAccess(TIER_FEATURES.ADVANCED_AUTHORIZATION_BUNDLES);
    await assertSecuritySettingsPermission(user, 'read');

    const { knex } = await createTenantKnex();
    const users = await knex('users')
      .where({ tenant })
      .orderBy('username', 'asc')
      .limit(50)
      .select<
        Array<{
          user_id: string;
          first_name: string | null;
          last_name: string | null;
          username: string | null;
          email: string | null;
        }>
      >('user_id', 'first_name', 'last_name', 'username', 'email');

    return users.map((item) => ({
      id: item.user_id,
      label:
        [item.first_name, item.last_name].filter(Boolean).join(' ').trim() ||
        item.username ||
        item.email ||
        item.user_id,
    }));
  }
);

export const listAuthorizationSimulationRecordsAction = withAuth(
  async (
    user,
    { tenant },
    input: { resourceType: string }
  ): Promise<AuthorizationSimulationOption[]> => {
    await assertTierAccess(TIER_FEATURES.ADVANCED_AUTHORIZATION_BUNDLES);
    await assertSecuritySettingsPermission(user, 'read');

    const { knex } = await createTenantKnex();

    if (input.resourceType === 'ticket') {
      const rows = await knex('tickets')
        .where({ tenant })
        .orderBy('updated_at', 'desc')
        .limit(50)
        .select<{ ticket_id: string; title: string | null }[]>('ticket_id', 'title');
      return rows.map((row) => ({ id: row.ticket_id, label: row.title || row.ticket_id }));
    }

    if (input.resourceType === 'document') {
      const rows = await knex('documents')
        .where({ tenant })
        .orderBy('created_at', 'desc')
        .limit(50)
        .select<{ document_id: string; document_name: string | null }[]>('document_id', 'document_name');
      return rows.map((row) => ({ id: row.document_id, label: row.document_name || row.document_id }));
    }

    if (input.resourceType === 'time_entry') {
      const rows = await knex('time_entries')
        .where({ tenant })
        .orderBy('start_time', 'desc')
        .limit(50)
        .select<{ entry_id: string; notes: string | null }[]>('entry_id', 'notes');
      return rows.map((row) => ({ id: row.entry_id, label: row.notes || row.entry_id }));
    }

    if (input.resourceType === 'project') {
      const rows = await knex('projects')
        .where({ tenant })
        .orderBy('updated_at', 'desc')
        .limit(50)
        .select<{ project_id: string; project_name: string | null }[]>('project_id', 'project_name');
      return rows.map((row) => ({ id: row.project_id, label: row.project_name || row.project_id }));
    }

    if (input.resourceType === 'asset') {
      const rows = await knex('assets')
        .where({ tenant })
        .orderBy('updated_at', 'desc')
        .limit(50)
        .select<{ asset_id: string; name: string | null }[]>('asset_id', 'name');
      return rows.map((row) => ({ id: row.asset_id, label: row.name || row.asset_id }));
    }

    const rows = await knex('quotes')
      .where({ tenant })
      .orderBy('updated_at', 'desc')
      .limit(50)
      .select<{ quote_id: string; quote_number: string | null }[]>('quote_id', 'quote_number');
    return rows.map((row) => ({ id: row.quote_id, label: row.quote_number || row.quote_id }));
  }
);

function normalizeBundleRules(
  rules: Awaited<ReturnType<typeof listBundleRulesForRevision>>
): BundleNarrowingRule[] {
  const normalizeRuleIdList = (value: unknown): string[] | undefined => {
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
  };

  return rules.map((rule) => ({
    id: rule.ruleId,
    resource: rule.resourceType,
    action: rule.action,
    templateKey: rule.templateKey as RelationshipTemplateKey,
    constraintKey: rule.constraintKey ?? null,
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

function toAuthorizationRecord(row: Record<string, unknown>): AuthorizationRecord {
  const ownerUserId =
    (typeof row.user_id === 'string' ? row.user_id : null) ??
    (typeof row.created_by === 'string' ? row.created_by : null) ??
    (typeof row.entered_by === 'string' ? row.entered_by : null);

  return {
    id:
      (typeof row.ticket_id === 'string' ? row.ticket_id : null) ??
      (typeof row.document_id === 'string' ? row.document_id : null) ??
      (typeof row.entry_id === 'string' ? row.entry_id : null) ??
      (typeof row.project_id === 'string' ? row.project_id : null) ??
      (typeof row.asset_id === 'string' ? row.asset_id : null) ??
      (typeof row.quote_id === 'string' ? row.quote_id : null) ??
      (typeof row.invoice_id === 'string' ? row.invoice_id : null),
    ownerUserId,
    clientId: typeof row.client_id === 'string' ? row.client_id : null,
    boardId: typeof row.board_id === 'string' ? row.board_id : null,
    is_client_visible: row.is_client_visible,
  };
}

async function loadSimulationRecord(
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'],
  tenant: string,
  resourceType: string,
  resourceId: string
): Promise<AuthorizationRecord> {
  if (resourceType === 'ticket') {
    const row = await knex('tickets').where({ tenant, ticket_id: resourceId }).first();
    if (!row) throw new Error('Ticket not found.');
    return toAuthorizationRecord(row);
  }
  if (resourceType === 'document') {
    const row = await knex('documents').where({ tenant, document_id: resourceId }).first();
    if (!row) throw new Error('Document not found.');
    return toAuthorizationRecord(row);
  }
  if (resourceType === 'time_entry') {
    const row = await knex('time_entries').where({ tenant, entry_id: resourceId }).first();
    if (!row) throw new Error('Time entry not found.');
    return toAuthorizationRecord(row);
  }
  if (resourceType === 'project') {
    const row = await knex('projects').where({ tenant, project_id: resourceId }).first();
    if (!row) throw new Error('Project not found.');
    return toAuthorizationRecord(row);
  }
  if (resourceType === 'asset') {
    const row = await knex('assets').where({ tenant, asset_id: resourceId }).first();
    if (!row) throw new Error('Asset not found.');
    return toAuthorizationRecord(row);
  }

  const row = await knex('quotes').where({ tenant, quote_id: resourceId }).first();
  if (!row) throw new Error('Quote not found.');
  return toAuthorizationRecord(row);
}

function assertSimulationModeSupported(input: {
  resourceType: string;
  action: string;
  principalUserType: 'internal' | 'client';
}): void {
  if (!SUPPORTED_SIMULATION_ACTIONS.has(input.action)) {
    throw new Error(
      `Simulator only supports read/approve actions in this remediation; "${input.action}" is not currently modeled faithfully.`
    );
  }

  if (input.resourceType === 'ticket' && input.principalUserType === 'client') {
    throw new Error(
      'Ticket simulation for client principals is not supported in this remediation because board-visibility builtin invariants are not modeled yet.'
    );
  }
}

function applySimulationInvariantNarrowing(input: {
  resourceType: string;
  action: string;
  principalUserId: string;
  principalUserType: 'internal' | 'client';
  record: AuthorizationRecord;
  decision: { allowed: boolean; reasons: AuthorizationReason[] };
}): { allowed: boolean; reasons: AuthorizationReason[] } {
  if (!input.decision.allowed) {
    return input.decision;
  }

  if (input.resourceType === 'document' && input.action === 'read' && input.principalUserType === 'client') {
    const isOwner = input.record.ownerUserId === input.principalUserId;
    const isClientVisible = input.record.is_client_visible === true;
    if (!isOwner && !isClientVisible) {
      return {
        allowed: false,
        reasons: [
          ...input.decision.reasons,
          {
            stage: 'builtin',
            sourceType: 'builtin',
            code: 'document_client_visibility_denied',
            message: 'Client principals can only access own documents unless the record is client-visible.',
          },
        ],
      };
    }
  }

  return input.decision;
}

export const runAuthorizationBundleSimulationAction = withAuth(
  async (
    user,
    { tenant },
    input: {
      bundleId: string;
      principalUserId: string;
      resourceType: string;
      action: string;
      resourceId?: string;
      syntheticRecord?: {
        ownerUserId?: string | null;
        clientId?: string | null;
        boardId?: string | null;
        isClientVisible?: boolean;
      };
    }
  ): Promise<AuthorizationBundleSimulationPayload> => {
    await assertTierAccess(TIER_FEATURES.ADVANCED_AUTHORIZATION_BUNDLES);
    await assertSecuritySettingsPermission(user, 'read');

    const { knex } = await createTenantKnex();
    const principal = await knex('users')
      .where({
        tenant,
        user_id: input.principalUserId,
      })
      .first<{ user_id: string; user_type: 'internal' | 'client'; client_id: string | null }>(
        'user_id',
        'user_type',
        'client_id'
      );

    if (!principal) {
      throw new Error('Principal user not found in tenant scope.');
    }

    assertSimulationModeSupported({
      resourceType: input.resourceType,
      action: input.action,
      principalUserType: principal.user_type,
    });

    const canWrite = await hasPermission(user as any, 'system_settings', 'write');

    const [roleRows, teamRows, managedRows, bundle] = await Promise.all([
      knex('user_roles').where({ tenant, user_id: principal.user_id }).select<{ role_id: string }[]>('role_id'),
      knex('team_members').where({ tenant, user_id: principal.user_id }).select<{ team_id: string }[]>('team_id'),
      knex('users').where({ tenant, reports_to: principal.user_id }).select<{ user_id: string }[]>('user_id'),
      knex('authorization_bundles')
        .where({
          tenant,
          bundle_id: input.bundleId,
        })
        .first<{ published_revision_id: string | null }>('published_revision_id'),
    ]);

    if (!bundle) {
      throw new Error('Bundle not found in tenant scope.');
    }

    const draftRevisionId = canWrite
      ? (
          await ensureDraftBundleRevision(knex, {
            tenant,
            bundleId: input.bundleId,
            actorUserId: user.user_id,
          })
        ).revisionId
      : (
          await knex('authorization_bundle_revisions')
            .where({
              tenant,
              bundle_id: input.bundleId,
              lifecycle_state: 'draft',
            })
            .orderBy('revision_number', 'desc')
            .first<{ revision_id: string }>('revision_id')
        )?.revision_id ?? bundle.published_revision_id;

    if (!draftRevisionId) {
      throw new Error('Draft or published revision not found for bundle in tenant scope.');
    }

    const record = input.syntheticRecord
      ? {
          id: null,
          ownerUserId: input.syntheticRecord.ownerUserId ?? null,
          clientId: input.syntheticRecord.clientId ?? null,
          boardId: input.syntheticRecord.boardId ?? null,
          is_client_visible: input.syntheticRecord.isClientVisible ?? false,
        }
      : await loadSimulationRecord(knex, tenant, input.resourceType, input.resourceId || '');

    const draftRules = normalizeBundleRules(
      await listBundleRulesForRevision(knex, {
        tenant,
        revisionId: draftRevisionId,
      })
    );
    const publishedRules = bundle.published_revision_id
      ? normalizeBundleRules(
          await listBundleRulesForRevision(knex, {
            tenant,
            revisionId: bundle.published_revision_id,
          })
        )
      : [];

    const createKernelWithRules = (rules: BundleNarrowingRule[]) =>
      createAuthorizationKernel({
        builtinProvider: new BuiltinAuthorizationKernelProvider({
          relationshipRules:
            input.resourceType === 'document' && principal.user_type === 'client' && input.action === 'read'
              ? [{ template: 'own' }, { template: 'same_client' }]
              : [],
          mutationGuards:
            input.action === 'approve' &&
            (input.resourceType === 'billing' || input.resourceType === 'time_entry')
              ? [
                  (evaluationInput) => {
                    const ownerUserId = evaluationInput.record?.ownerUserId;
                    if (typeof ownerUserId === 'string' && ownerUserId === evaluationInput.subject.userId) {
                      return {
                        allowed: false,
                        reasons: [
                          {
                            stage: 'mutation' as const,
                            sourceType: 'builtin' as const,
                            code:
                              input.resourceType === 'billing'
                                ? 'billing_not_self_approver_denied'
                                : 'timesheet_not_self_approver_denied',
                            message:
                              input.resourceType === 'billing'
                                ? 'Approvers cannot approve their own quotes.'
                                : 'Approvers cannot approve their own time submissions.',
                          },
                        ],
                      };
                    }

                    return {
                      allowed: true,
                      reasons: [
                        {
                          stage: 'mutation' as const,
                          sourceType: 'builtin' as const,
                          code:
                            input.resourceType === 'billing'
                              ? 'billing_not_self_approver_passed'
                              : 'timesheet_not_self_approver_passed',
                          message:
                            input.resourceType === 'billing'
                              ? 'Not-self-approver guard passed for billing approvals.'
                              : 'Not-self-approver guard passed for time approvals.',
                        },
                      ],
                    };
                  },
                ]
              : [],
        }),
        bundleProvider: new BundleAuthorizationKernelProvider({
          resolveRules: async () => rules,
        }),
      });

    const evaluationInput = {
      subject: {
        tenant,
        userId: principal.user_id,
        userType: principal.user_type,
        roleIds: roleRows.map((row) => row.role_id),
        teamIds: teamRows.map((row) => row.team_id),
        clientId: principal.client_id,
        managedUserIds: managedRows.map((row) => row.user_id),
        portfolioClientIds: [],
      },
      resource: {
        type: input.resourceType,
        action: input.action,
        id: input.resourceId ?? null,
      },
      record,
      knex,
    };

    const evaluateDecision = async (rules: BundleNarrowingRule[]) => {
      const kernel = createKernelWithRules(rules);
      const decision =
        input.action === 'approve'
          ? await kernel.authorizeMutation({
              ...evaluationInput,
              mutation: {
                kind: 'approve',
                record,
              },
            })
          : await kernel.authorizeResource(evaluationInput);

      return applySimulationInvariantNarrowing({
        resourceType: input.resourceType,
        action: input.action,
        principalUserId: principal.user_id,
        principalUserType: principal.user_type,
        record,
        decision,
      });
    };

    const [draftDecision, publishedDecision] = await Promise.all([
      evaluateDecision(draftRules),
      evaluateDecision(publishedRules),
    ]);

    return {
      draft: {
        allowed: draftDecision.allowed,
        reasonCodes: draftDecision.reasons.map((reason) => `${reason.stage}:${reason.code}`),
      },
      published: {
        allowed: publishedDecision.allowed,
        reasonCodes: publishedDecision.reasons.map((reason) => `${reason.stage}:${reason.code}`),
      },
    };
  }
);

export const publishAuthorizationBundleDraftAction = withAuth(
  async (user, { tenant }, bundleId: string): Promise<void> => {
    await assertTierAccess(TIER_FEATURES.ADVANCED_AUTHORIZATION_BUNDLES);
    await assertSecuritySettingsPermission(user, 'write');

    const { knex } = await createTenantKnex();
    const draft = await ensureDraftBundleRevision(knex, {
      tenant,
      bundleId,
      actorUserId: user.user_id,
    });

    await publishBundleRevision(knex, {
      tenant,
      bundleId,
      revisionId: draft.revisionId,
      actorUserId: user.user_id,
    });
  }
);

export const createAuthorizationBundleAssignmentAction = withAuth(
  async (
    user,
    { tenant },
    input: {
      bundleId: string;
      targetType: 'role' | 'team' | 'user' | 'api_key';
      targetId: string;
    }
  ): Promise<void> => {
    await assertTierAccess(TIER_FEATURES.ADVANCED_AUTHORIZATION_BUNDLES);
    await assertSecuritySettingsPermission(user, 'write');

    const { knex } = await createTenantKnex();
    await createBundleAssignment(knex, {
      tenant,
      bundleId: input.bundleId,
      targetType: input.targetType,
      targetId: input.targetId,
      actorUserId: user.user_id,
    });
  }
);

export const setAuthorizationBundleAssignmentStatusAction = withAuth(
  async (
    user,
    { tenant },
    input: {
      assignmentId: string;
      status: 'active' | 'disabled';
    }
  ): Promise<void> => {
    await assertTierAccess(TIER_FEATURES.ADVANCED_AUTHORIZATION_BUNDLES);
    await assertSecuritySettingsPermission(user, 'write');

    const { knex } = await createTenantKnex();
    await setBundleAssignmentStatus(knex, {
      tenant,
      assignmentId: input.assignmentId,
      status: input.status,
      actorUserId: user.user_id,
    });
  }
);

export const getAuthorizationBundleAuditTrailAction = withAuth(
  async (user, { tenant }, bundleId: string): Promise<AuthorizationBundleAuditEvent[]> => {
    await assertTierAccess(TIER_FEATURES.ADVANCED_AUTHORIZATION_BUNDLES);
    await assertSecuritySettingsPermission(user, 'read');

    const { knex } = await createTenantKnex();

    const [bundle, revisions, assignments] = await Promise.all([
      knex('authorization_bundles')
        .where({ tenant, bundle_id: bundleId })
        .first<{
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          status: 'active' | 'archived';
        }>('created_at', 'created_by', 'updated_at', 'updated_by', 'status'),
      knex('authorization_bundle_revisions')
        .where({ tenant, bundle_id: bundleId })
        .select<
          Array<{
            revision_id: string;
            lifecycle_state: 'draft' | 'published' | 'archived';
            created_at: string;
            created_by: string | null;
            published_at: string | null;
            published_by: string | null;
            summary: string | null;
          }>
        >('revision_id', 'lifecycle_state', 'created_at', 'created_by', 'published_at', 'published_by', 'summary'),
      knex('authorization_bundle_assignments')
        .where({ tenant, bundle_id: bundleId })
        .select<
          Array<{
            assignment_id: string;
            target_type: string;
            target_id: string;
            status: 'active' | 'disabled';
            created_at: string;
            created_by: string | null;
            updated_at: string;
            updated_by: string | null;
          }>
        >('assignment_id', 'target_type', 'target_id', 'status', 'created_at', 'created_by', 'updated_at', 'updated_by'),
    ]);

    if (!bundle) {
      throw new Error('Bundle not found in tenant scope.');
    }

    const events: AuthorizationBundleAuditEvent[] = [
      {
        eventType: 'bundle_created',
        occurredAt: bundle.created_at,
        actorUserId: bundle.created_by,
        metadata: { status: bundle.status },
      },
    ];

    if (bundle.status === 'archived') {
      events.push({
        eventType: 'bundle_archived',
        occurredAt: bundle.updated_at,
        actorUserId: bundle.updated_by,
        metadata: {},
      });
    }

    for (const revision of revisions) {
      events.push({
        eventType: 'revision_drafted',
        occurredAt: revision.created_at,
        actorUserId: revision.created_by,
        metadata: {
          revisionId: revision.revision_id,
          summary: revision.summary,
          lifecycleState: revision.lifecycle_state,
        },
      });

      if (revision.published_at) {
        events.push({
          eventType: 'revision_published',
          occurredAt: revision.published_at,
          actorUserId: revision.published_by,
          metadata: {
            revisionId: revision.revision_id,
          },
        });
      }
    }

    for (const assignment of assignments) {
      events.push({
        eventType: 'assignment_created',
        occurredAt: assignment.created_at,
        actorUserId: assignment.created_by,
        metadata: {
          assignmentId: assignment.assignment_id,
          targetType: assignment.target_type,
          targetId: assignment.target_id,
          status: assignment.status,
        },
      });

      if (assignment.updated_at !== assignment.created_at) {
        events.push({
          eventType: 'assignment_updated',
          occurredAt: assignment.updated_at,
          actorUserId: assignment.updated_by,
          metadata: {
            assignmentId: assignment.assignment_id,
            status: assignment.status,
          },
        });
      }
    }

    events.sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());
    return events;
  }
);
