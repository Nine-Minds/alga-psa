/**
 * Utility functions for cleaning up tags when entities are deleted
 * Used across different entity deletion operations
 */

import { Knex } from 'knex';
import type { TaggedEntityType } from '@alga-psa/types';
import { requireTenantId } from '@alga-psa/db';
import TagMapping from '../models/tagMapping';
import TagDefinition from '../models/tagDefinition';

/**
 * Delete all tags associated with an entity.
 * Also cleans up any tag definitions that become orphaned (no remaining mappings).
 */
export async function deleteEntityTags(
  trx: Knex.Transaction,
  entityId: string,
  entityType: TaggedEntityType
): Promise<number> {
  const tenant = await requireTenantId(trx);

  // Collect tag_ids before deleting mappings
  const mappings = await trx('tag_mappings')
    .where({ tenant, tagged_id: entityId, tagged_type: entityType })
    .select('tag_id');
  const tagIds = [...new Set(mappings.map(m => m.tag_id))];

  const deleted = await TagMapping.deleteByEntity(trx, tenant, entityId, entityType);

  // Clean up any now-orphaned definitions
  if (tagIds.length > 0) {
    await TagDefinition.deleteOrphaned(trx, tenant, tagIds);
  }

  return deleted;
}

/**
 * Delete tags for multiple entities.
 * Also cleans up any tag definitions that become orphaned (no remaining mappings).
 */
export async function deleteEntitiesTags(
  trx: Knex.Transaction,
  entityIds: string[],
  entityType: TaggedEntityType
): Promise<number> {
  const tenant = await requireTenantId(trx);

  if (entityIds.length === 0) {
    return 0;
  }

  // Collect tag_ids before deleting mappings
  const mappings = await trx('tag_mappings')
    .where({ tenant, tagged_type: entityType })
    .whereIn('tagged_id', entityIds)
    .select('tag_id');
  const tagIds = [...new Set(mappings.map(m => m.tag_id))];

  const result = await trx('tag_mappings')
    .where({
      tenant,
      tagged_type: entityType
    })
    .whereIn('tagged_id', entityIds)
    .delete();

  // Clean up any now-orphaned definitions
  if (tagIds.length > 0) {
    await TagDefinition.deleteOrphaned(trx, tenant, tagIds);
  }

  return result;
}

/**
 * Transfer tags from one entity to another
 * Useful when merging entities
 */
export async function transferEntityTags(
  trx: Knex.Transaction,
  fromEntityId: string,
  toEntityId: string,
  entityType: TaggedEntityType
): Promise<number> {
  const tenant = await requireTenantId(trx);

  // Get existing tags on target to avoid duplicates
  const existingTargetTags = await trx('tag_mappings')
    .where({
      tenant,
      tagged_id: toEntityId,
      tagged_type: entityType
    })
    .select('tag_id');
  
  const existingTagIds = existingTargetTags.map(t => t.tag_id);
  
  // Update mappings that don't already exist on target
  const result = await trx('tag_mappings')
    .where({
      tenant,
      tagged_id: fromEntityId,
      tagged_type: entityType
    })
    .whereNotIn('tag_id', existingTagIds.length > 0 ? existingTagIds : [''])
    .update({
      tagged_id: toEntityId
    });
  
  // Delete remaining tags from source (duplicates)
  await trx('tag_mappings')
    .where({
      tenant,
      tagged_id: fromEntityId,
      tagged_type: entityType
    })
    .delete();
  
  return result;
}

