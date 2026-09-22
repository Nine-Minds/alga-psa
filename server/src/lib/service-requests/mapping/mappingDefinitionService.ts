import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';
import {
  getMappingDestinationProvider,
  listMappingTargetFieldCatalog,
  type MappingTargetFieldCatalogEntry,
} from './destinations';
import { isUniqueViolationOnIndex } from '../pgUniqueConstraint';
import { normalizeRulesSnapshot } from './mappingRules';
import type {
  AssetSelector,
  MappingRule,
  MappingRulesSnapshot,
} from './types';

/**
 * Mapping definition + versioning services. Mirrors the definition/version
 * split in definitionPublishing.ts: a mutable working copy (`rules` JSONB) and
 * immutable numbered snapshots (`rules_snapshot`). Publishing is a direct
 * structural copy of `publishServiceRequestDefinition`.
 */

const MAPPING_DEFINITION_UNIQUE_INDEX = 'service_request_answer_mappings_definition_unique';
const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const ATTRIBUTE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

export interface ServiceRequestAnswerMappingRuleInput {
  ruleId?: string;
  questionKey: string;
  destinationKind: string;
  targetFieldKey: string;
  assetSelector?: AssetSelector;
  transform?: Record<string, unknown>;
}

export interface ServiceRequestAnswerMappingRow {
  tenant: string;
  mapping_id: string;
  definition_id: string;
  lifecycle_state: 'draft' | 'published';
  current_version_id: string | null;
  rules: MappingRulesSnapshot;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ServiceRequestAnswerMappingVersionRecord {
  tenant: string;
  version_id: string;
  mapping_id: string;
  definition_id: string;
  version_number: number;
  rules_snapshot: MappingRulesSnapshot;
  published_by: string | null;
  published_at: Date;
  created_at: Date;
}

export interface ServiceRequestAnswerMappingEditorData {
  mappingId: string;
  definitionId: string;
  lifecycleState: 'draft' | 'published';
  currentVersionId: string | null;
  publishedVersionNumber: number | null;
  publishedAt: Date | null;
  hasUnpublishedChanges: boolean;
  rules: MappingRule[];
  targetFieldCatalog: MappingTargetFieldCatalogEntry[];
}

function rulesEqual(a: MappingRulesSnapshot, b: MappingRulesSnapshot): boolean {
  return JSON.stringify(a.rules ?? []) === JSON.stringify(b.rules ?? []);
}

export function validateMappingRule(
  rule: ServiceRequestAnswerMappingRuleInput
): string[] {
  const errors: string[] = [];

  if (!rule.questionKey || !FIELD_KEY_PATTERN.test(rule.questionKey)) {
    errors.push('A valid question must be selected');
  }

  const provider = getMappingDestinationProvider(rule.destinationKind);
  if (!provider) {
    errors.push('A valid destination kind must be selected');
    return errors;
  }

  if (!provider.getTargetField(rule.targetFieldKey)) {
    errors.push('The destination field is not in the allowlist for this destination');
  }

  if (rule.destinationKind === 'asset') {
    const selector = rule.assetSelector;
    if (!selector || typeof selector !== 'object') {
      errors.push('An asset selector is required for asset mappings');
    } else if (selector.strategy === 'answer-asset-ref') {
      if (!selector.assetRefQuestionKey || !FIELD_KEY_PATTERN.test(selector.assetRefQuestionKey)) {
        errors.push('A valid asset-reference question must be selected');
      }
    } else if (selector.strategy === 'match-attribute') {
      if (!['asset_tag', 'serial_number', 'name'].includes(selector.matchAttribute)) {
        errors.push('A valid asset attribute must be selected');
      }
      if (!selector.matchQuestionKey || !FIELD_KEY_PATTERN.test(selector.matchQuestionKey)) {
        errors.push('A valid match question must be selected');
      }
    } else {
      errors.push('A valid asset selector strategy is required');
    }
  }

  if (rule.destinationKind === 'asset' && rule.targetFieldKey.startsWith('attributes.')) {
    const attributeKey = rule.targetFieldKey.slice('attributes.'.length);
    if (!ATTRIBUTE_KEY_PATTERN.test(attributeKey)) {
      errors.push('A valid asset attribute key is required');
    }
  }

  return errors;
}

function toMappingRule(input: ServiceRequestAnswerMappingRuleInput, existingRuleId?: string): MappingRule {
  const rule: MappingRule = {
    ruleId: input.ruleId ?? existingRuleId ?? uuidv4(),
    questionKey: input.questionKey,
    destinationKind: input.destinationKind,
    targetFieldKey: input.targetFieldKey,
  };
  if (input.destinationKind === 'asset' && input.assetSelector) {
    rule.assetSelector = input.assetSelector;
  }
  if (input.transform) {
    rule.transform = input.transform;
  }
  return rule;
}

async function loadMappingRow(
  knex: Knex,
  tenant: string,
  definitionId: string
): Promise<ServiceRequestAnswerMappingRow | undefined> {
  return tenantDb(knex, tenant)
    .table('service_request_answer_mappings')
    .where({ definition_id: definitionId })
    .first<ServiceRequestAnswerMappingRow | undefined>();
}

export async function getOrCreateAnswerMapping(
  knex: Knex,
  tenant: string,
  definitionId: string,
  actorUserId?: string | null
): Promise<ServiceRequestAnswerMappingRow> {
  const existing = await loadMappingRow(knex, tenant, definitionId);
  if (existing) {
    return existing;
  }

  try {
    const [created] = await tenantDb(knex, tenant)
      .table('service_request_answer_mappings')
      .insert({
        tenant,
        definition_id: definitionId,
        lifecycle_state: 'draft',
        rules: { rules: [] },
        created_by: actorUserId ?? null,
        updated_by: actorUserId ?? null,
      })
      .returning('*');
    return created as ServiceRequestAnswerMappingRow;
  } catch (error) {
    if (isUniqueViolationOnIndex(error, MAPPING_DEFINITION_UNIQUE_INDEX)) {
      const winner = await loadMappingRow(knex, tenant, definitionId);
      if (winner) {
        return winner;
      }
    }
    throw error;
  }
}

async function saveMappingRules(
  knex: Knex,
  tenant: string,
  definitionId: string,
  rules: MappingRule[],
  updatedBy?: string | null
): Promise<ServiceRequestAnswerMappingRow> {
  const mapping = await getOrCreateAnswerMapping(knex, tenant, definitionId, updatedBy);
  const [updated] = await tenantDb(knex, tenant)
    .table('service_request_answer_mappings')
    .where({ mapping_id: mapping.mapping_id })
    .update({
      rules: { rules },
      updated_by: updatedBy ?? null,
      updated_at: knex.fn.now(),
    })
    .returning('*');
  return updated as ServiceRequestAnswerMappingRow;
}

export async function addAnswerMappingRule(input: {
  knex: Knex;
  tenant: string;
  definitionId: string;
  rule: ServiceRequestAnswerMappingRuleInput;
  updatedBy?: string | null;
}): Promise<ServiceRequestAnswerMappingRow> {
  const errors = validateMappingRule(input.rule);
  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }
  const mapping = await getOrCreateAnswerMapping(
    input.knex,
    input.tenant,
    input.definitionId,
    input.updatedBy
  );
  const current = normalizeRulesSnapshot(mapping.rules);
  const nextRules = [...current.rules, toMappingRule(input.rule)];
  return saveMappingRules(input.knex, input.tenant, input.definitionId, nextRules, input.updatedBy);
}

export async function updateAnswerMappingRule(input: {
  knex: Knex;
  tenant: string;
  definitionId: string;
  ruleId: string;
  rule: ServiceRequestAnswerMappingRuleInput;
  updatedBy?: string | null;
}): Promise<ServiceRequestAnswerMappingRow> {
  const errors = validateMappingRule(input.rule);
  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }
  const mapping = await getOrCreateAnswerMapping(
    input.knex,
    input.tenant,
    input.definitionId,
    input.updatedBy
  );
  const current = normalizeRulesSnapshot(mapping.rules);
  if (!current.rules.some((rule) => rule.ruleId === input.ruleId)) {
    throw new Error('Mapping rule not found');
  }
  const nextRules = current.rules.map((rule) =>
    rule.ruleId === input.ruleId ? toMappingRule(input.rule, input.ruleId) : rule
  );
  return saveMappingRules(input.knex, input.tenant, input.definitionId, nextRules, input.updatedBy);
}

export async function removeAnswerMappingRule(input: {
  knex: Knex;
  tenant: string;
  definitionId: string;
  ruleId: string;
  updatedBy?: string | null;
}): Promise<ServiceRequestAnswerMappingRow> {
  const mapping = await getOrCreateAnswerMapping(
    input.knex,
    input.tenant,
    input.definitionId,
    input.updatedBy
  );
  const current = normalizeRulesSnapshot(mapping.rules);
  const nextRules = current.rules.filter((rule) => rule.ruleId !== input.ruleId);
  return saveMappingRules(input.knex, input.tenant, input.definitionId, nextRules, input.updatedBy);
}

export async function publishAnswerMapping(input: {
  knex: Knex;
  tenant: string;
  definitionId: string;
  publishedBy?: string | null;
}): Promise<ServiceRequestAnswerMappingVersionRecord> {
  const { knex, tenant, definitionId, publishedBy = null } = input;

  return knex.transaction(async (trx) => {
    const db = tenantDb(trx, tenant);
    const mapping = await loadMappingRow(trx, tenant, definitionId);
    if (!mapping) {
      throw new Error('Answer mapping not found');
    }

    const currentMaxVersion = await db.table('service_request_answer_mapping_versions')
      .where({ mapping_id: mapping.mapping_id })
      .max<{ maxVersion: string | number | null }>('version_number as maxVersion')
      .first();
    const nextVersionNumber = Number(currentMaxVersion?.maxVersion ?? 0) + 1;

    const [createdVersion] = (await db.table('service_request_answer_mapping_versions')
      .insert({
        tenant,
        mapping_id: mapping.mapping_id,
        definition_id: definitionId,
        version_number: nextVersionNumber,
        rules_snapshot: normalizeRulesSnapshot(mapping.rules),
        published_by: publishedBy,
      })
      .returning('*')) as ServiceRequestAnswerMappingVersionRecord[];

    await db.table('service_request_answer_mappings')
      .where({ mapping_id: mapping.mapping_id })
      .update({
        lifecycle_state: 'published',
        current_version_id: createdVersion.version_id,
        updated_by: publishedBy,
        updated_at: trx.fn.now(),
      });

    return createdVersion;
  });
}

export async function getServiceRequestAnswerMappingEditorData(
  knex: Knex,
  tenant: string,
  definitionId: string
): Promise<ServiceRequestAnswerMappingEditorData> {
  const mapping = await getOrCreateAnswerMapping(knex, tenant, definitionId);
  const db = tenantDb(knex, tenant);

  const currentVersion = mapping.current_version_id
    ? ((await db.table('service_request_answer_mapping_versions')
        .where({ version_id: mapping.current_version_id })
        .first()) as ServiceRequestAnswerMappingVersionRecord | undefined)
    : undefined;

  const latestVersion = currentVersion
    ? currentVersion
    : ((await db.table('service_request_answer_mapping_versions')
        .where({ mapping_id: mapping.mapping_id })
        .orderBy('version_number', 'desc')
        .first()) as ServiceRequestAnswerMappingVersionRecord | undefined);

  const workingRules = normalizeRulesSnapshot(mapping.rules);
  const hasUnpublishedChanges = latestVersion
    ? !rulesEqual(workingRules, normalizeRulesSnapshot(latestVersion.rules_snapshot))
    : workingRules.rules.length > 0;

  return {
    mappingId: mapping.mapping_id,
    definitionId,
    lifecycleState: mapping.lifecycle_state,
    currentVersionId: mapping.current_version_id,
    publishedVersionNumber: latestVersion?.version_number ?? null,
    publishedAt: latestVersion?.published_at ?? null,
    hasUnpublishedChanges,
    rules: workingRules.rules,
    targetFieldCatalog: listMappingTargetFieldCatalog(),
  };
}

export async function getCurrentMappingVersionId(
  knex: Knex,
  tenant: string,
  definitionId: string
): Promise<string | null> {
  const mapping = await loadMappingRow(knex, tenant, definitionId);
  return mapping?.current_version_id ?? null;
}
