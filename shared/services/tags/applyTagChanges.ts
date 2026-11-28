/**
 * Tag writes for workflow actions. Operates on the caller's transaction and
 * tenant (no nested withTransaction, no new connection), building only on
 * TagModel so the rows written are the ones the UI reads.
 *
 * Tag text rules mirror the UI (packages/tags validateTagText / bulkApplyTagsToEntities):
 * trim, drop empties, validate, dedupe case-insensitively keeping the first-seen
 * casing. Matching against existing definitions and mappings is case-insensitive,
 * so a workflow-added "urgent" reuses the UI's "Urgent" instead of duplicating it.
 */
import type { Knex } from 'knex';
import { TagModel, validateTagText } from '../../models/tagModel';
import type { TaggedEntityType } from '../../interfaces/tag.interfaces';

export interface TagChangeTarget {
  entityType: TaggedEntityType;
  entityId: string;
  tags: string[];
}

export interface AddTagsInput extends TagChangeTarget {
  actorUserId?: string | null;
}

export interface AddTagsResult {
  added: number;
  skipped: number;
}

export interface RemoveTagsResult {
  removed: number;
  missing: number;
}

export interface ReplaceTagsResult extends AddTagsResult, RemoveTagsResult {}

/**
 * Trim, drop empties, and dedupe case-insensitively (first-seen casing wins).
 * With `validate`, also reject text the UI would not accept; that matters only
 * when creating definitions, so removal does not validate (legacy tags stay removable).
 */
export function normalizeTagTexts(tags: string[], options: { validate?: boolean } = {}): string[] {
  const seen = new Map<string, string>();
  for (const raw of tags ?? []) {
    const text = (raw ?? '').trim();
    if (!text) continue;
    const validation = options.validate ? validateTagText(text) : { valid: true as const, errors: undefined };
    if (!validation.valid) {
      throw new Error(`Validation failed: tag "${text}": ${validation.errors?.join('; ')}`);
    }
    const lower = text.toLowerCase();
    if (!seen.has(lower)) seen.set(lower, text);
  }
  return Array.from(seen.values());
}

async function currentMappings(
  trx: Knex.Transaction,
  tenant: string,
  entityType: TaggedEntityType,
  entityId: string
): Promise<Map<string, { mapping_id: string; tag_text: string }>> {
  const rows = await TagModel.getTagsByEntity(entityId, entityType, tenant, trx);
  return new Map(rows.map((r) => [String(r.tag_text).toLowerCase(), { mapping_id: r.mapping_id, tag_text: r.tag_text }]));
}

export async function addTagsToEntity(
  trx: Knex.Transaction,
  tenant: string,
  input: AddTagsInput
): Promise<AddTagsResult> {
  const texts = normalizeTagTexts(input.tags, { validate: true });
  const mapped = await currentMappings(trx, tenant, input.entityType, input.entityId);
  let definitionsByLower: Map<string, string> | null = null;
  let added = 0;
  let skipped = 0;

  for (const text of texts) {
    if (mapped.has(text.toLowerCase())) {
      skipped += 1;
      continue;
    }
    if (!definitionsByLower) {
      const defs = await TagModel.getTagDefinitionsByType(input.entityType, tenant, trx);
      definitionsByLower = new Map(defs.map((d) => [d.tag_text.toLowerCase(), d.tag_text]));
    }
    // Reuse an existing definition whatever its casing; otherwise create it.
    const definitionText = definitionsByLower.get(text.toLowerCase()) ?? text;
    const definition = await TagModel.getOrCreateTagDefinition(definitionText, input.entityType, tenant, trx);
    definitionsByLower.set(definition.tag_text.toLowerCase(), definition.tag_text);
    if (await TagModel.tagExistsForEntity(definition.tag_text, input.entityId, input.entityType, tenant, trx)) {
      skipped += 1;
      continue;
    }
    await TagModel.createTagMapping(
      definition.tag_id,
      input.entityId,
      input.entityType,
      tenant,
      trx,
      input.actorUserId ?? undefined
    );
    added += 1;
  }

  return { added, skipped };
}

export async function removeTagsFromEntity(
  trx: Knex.Transaction,
  tenant: string,
  input: TagChangeTarget
): Promise<RemoveTagsResult> {
  const texts = normalizeTagTexts(input.tags);
  const mapped = await currentMappings(trx, tenant, input.entityType, input.entityId);
  let removed = 0;
  let missing = 0;

  for (const text of texts) {
    const mapping = mapped.get(text.toLowerCase());
    if (!mapping) {
      missing += 1;
      continue;
    }
    // Only the mapping goes; the definition may still be used by other entities.
    await TagModel.deleteTagMapping(mapping.mapping_id, tenant, trx);
    removed += 1;
  }

  return { removed, missing };
}

/**
 * Makes the entity's tags equal `tags` as a diff: unchanged mappings keep their
 * identity, only surplus mappings are removed and only missing ones are added.
 */
export async function replaceTagsOnEntity(
  trx: Knex.Transaction,
  tenant: string,
  input: AddTagsInput
): Promise<ReplaceTagsResult> {
  const target = normalizeTagTexts(input.tags, { validate: true });
  const targetLower = new Set(target.map((t) => t.toLowerCase()));
  const mapped = await currentMappings(trx, tenant, input.entityType, input.entityId);
  // Delete surplus mappings directly (not via removeTagsFromEntity) so a legacy tag whose
  // text would fail today's validation can still be cleared.
  let removed = 0;
  for (const [lower, mapping] of mapped) {
    if (targetLower.has(lower)) continue;
    await TagModel.deleteTagMapping(mapping.mapping_id, tenant, trx);
    removed += 1;
  }
  const { added, skipped } = await addTagsToEntity(trx, tenant, { ...input, tags: target });
  return { added, skipped, removed, missing: 0 };
}
