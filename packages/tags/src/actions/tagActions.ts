'use server'

import TagDefinition, { ITagDefinition } from '../models/tagDefinition';
import TagMapping, { ITagMapping, ITagWithDefinition } from '../models/tagMapping';
import { ITag, TaggedEntityType, PendingTag, IUserWithRoles } from '@alga-psa/types';
import { withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import { withAuth, withOptionalAuth, type AuthContext } from '@alga-psa/auth';
import { hasPermissionAsync, throwPermissionErrorAsync } from '../lib/authHelpers';
import { generateEntityColorAsync } from '../lib/uiHelpers';
import { Knex } from 'knex';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import {
  buildTagAppliedPayload,
  buildTagDefinitionCreatedPayload,
  buildTagDefinitionUpdatedPayload,
  buildTagRemovedPayload,
} from '@shared/workflow/streams/domainEventBuilders/tagEventBuilders';

export const findTagsByEntityId = withAuth(async (_user: IUserWithRoles, { tenant }: AuthContext, entityId: string, entityType: string): Promise<ITag[]> => {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const tagsWithDefinitions = await TagMapping.getByEntity(trx, tenant, entityId, entityType as TaggedEntityType);
      return tagsWithDefinitions.map(tag => ({
        tag_id: tag.mapping_id,
        tenant,
        board_id: tag.board_id || undefined,
        tag_text: tag.tag_text,
        tagged_id: tag.tagged_id,
        tagged_type: tag.tagged_type,
        background_color: tag.background_color,
        text_color: tag.text_color,
        created_by: tag.created_by
      }));
    });
  } catch (error) {
    console.error(`Error finding tags for ${entityType} id ${entityId}:`, error);
    throw new Error(`Failed to find tags for ${entityType} id: ${entityId}`);
  }
});

export const findTagById = withAuth(async (_user: IUserWithRoles, { tenant }: AuthContext, tagId: string): Promise<ITag | undefined> => {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // tagId is actually mapping_id in the new system
      const tag = await trx('tag_mappings as tm')
        .join('tag_definitions as td', function() {
          this.on('tm.tenant', '=', 'td.tenant')
              .andOn('tm.tag_id', '=', 'td.tag_id');
        })
        .where('tm.mapping_id', tagId)
        .where('tm.tenant', tenant)
        .select(
          'tm.mapping_id as tag_id',
          'td.board_id',
          'td.tag_text',
          'tm.tagged_id',
          'tm.tagged_type',
          'td.background_color',
          'td.text_color',
          'tm.tenant',
          'tm.created_by'
        )
        .first();

      if (!tag) {
        console.warn(`Tag with id ${tagId} not found`);
        return undefined;
      }

      return {
        tag_id: tag.tag_id,
        tenant: tag.tenant,
        board_id: tag.board_id || undefined,
        tag_text: tag.tag_text,
        tagged_id: tag.tagged_id,
        tagged_type: tag.tagged_type,
        background_color: tag.background_color,
        text_color: tag.text_color,
        created_by: tag.created_by
      };
    });
  } catch (error) {
    console.error(`Error finding tag with id ${tagId}:`, error);
    throw new Error(`Failed to find tag with id: ${tagId}`);
  }
});

export const createTag = withAuth(async (currentUser: IUserWithRoles, { tenant }: AuthContext, tag: Omit<ITag, 'tag_id' | 'tenant'>): Promise<ITag> => {
  // Validate tag text
  if (!tag.tag_text || !tag.tag_text.trim()) {
    throw new Error('Tag text is required');
  }

  const tagText = tag.tag_text.trim();

  // Validate length
  if (tagText.length > 50) {
    throw new Error('Tag text too long (max 50 characters)');
  }

  // Validate characters - allow letters, numbers, spaces, and common punctuation
  if (!/^[a-zA-Z0-9\-_\s!@#$%^&*()+=\][{};':",./<>?]+$/.test(tagText)) {
    throw new Error('Tag text contains invalid characters');
  }

  const userId = currentUser.user_id;

  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Check permissions
      // Convert tagged_type to resource name (e.g., 'project_task' -> 'project_task')
      // Map 'client' to 'client' for permission checks
      const entityResource = tag.tagged_type === 'client' ? 'client' : tag.tagged_type;

      if (!await hasPermissionAsync(currentUser, entityResource, 'update', trx)) {
        await throwPermissionErrorAsync(`update ${tag.tagged_type.replace('_', ' ')}`);
      }

      const existingTags = await TagDefinition.getAllByType(trx, tenant, tag.tagged_type);
      const existingTag = existingTags.find((t: ITagDefinition) => t.tag_text === tagText);

      // Check if this is a new tag (not in existing tags) - only then require tag:create permission
      if (!existingTag && !await hasPermissionAsync(currentUser, 'tag', 'create', trx)) {
        await throwPermissionErrorAsync('create new tags', 'You can only select from existing tags');
      }

      const tagWithTenant: Omit<ITag, 'tag_id' | 'tenant'> & {
        background_color?: string | null;
        text_color?: string | null
      } = { ...tag };

      if (existingTag && (existingTag.background_color || existingTag.text_color)) {
        // Use existing colors if this text already exists
        tagWithTenant.background_color = existingTag.background_color;
        tagWithTenant.text_color = existingTag.text_color;
      } else if (!tagWithTenant.background_color || !tagWithTenant.text_color) {
        // Generate and save colors for new tags
        const colors = await generateEntityColorAsync(tagText);
        tagWithTenant.background_color = tagWithTenant.background_color || colors.backgroundColor;
        tagWithTenant.text_color = tagWithTenant.text_color || colors.textColor;
      }

      // Get or create tag definition
      const { definition, created: createdDefinition } = await TagDefinition.getOrCreateWithStatus(
        trx,
        tenant,
        tagText,
        tagWithTenant.tagged_type,
        {
          board_id: tagWithTenant.board_id,
          background_color: tagWithTenant.background_color,
          text_color: tagWithTenant.text_color
        }
      );

      // Create mapping with user ID
      const mapping = await TagMapping.insert(trx, tenant, {
        tag_id: definition.tag_id,
        tagged_id: tagWithTenant.tagged_id,
        tagged_type: tagWithTenant.tagged_type
      }, userId);

      const occurredAt = new Date().toISOString();
      if (createdDefinition) {
        await publishWorkflowEvent({
          eventType: 'TAG_DEFINITION_CREATED',
          payload: buildTagDefinitionCreatedPayload({
            tagId: definition.tag_id,
            tagName: definition.tag_text,
            createdByUserId: userId,
            createdAt: definition.created_at ?? occurredAt,
          }),
          ctx: {
            tenantId: tenant,
            occurredAt,
            actor: { actorType: 'USER', actorUserId: userId },
          },
        });
      }

      await publishWorkflowEvent({
        eventType: 'TAG_APPLIED',
        payload: buildTagAppliedPayload({
          tagId: definition.tag_id,
          entityType: tagWithTenant.tagged_type,
          entityId: tagWithTenant.tagged_id,
          appliedByUserId: userId,
          appliedAt: mapping.created_at ?? occurredAt,
        }),
        ctx: {
          tenantId: tenant,
          occurredAt,
          actor: { actorType: 'USER', actorUserId: userId },
        },
      });

      const createdTag: ITag = {
        ...tagWithTenant,
        tag_id: mapping.mapping_id, // Return mapping_id as tag_id for backward compatibility
        tenant
      };
      return createdTag;
    } catch (error) {
      console.error(`Error creating tag:`, error);
      // Re-throw permission errors as-is
      if (error instanceof Error && error.message.includes('Permission denied')) {
        throw error;
      }
      throw new Error(`Failed to create tag`);
    }
  });
});

export const updateTag = withAuth(async (currentUser: IUserWithRoles, { tenant }: AuthContext, id: string, tag: Partial<ITag>): Promise<void> => {
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Get existing tag to check entity type (id is mapping_id)
      const existingTag = await trx('tag_mappings as tm')
        .join('tag_definitions as td', function() {
          this.on('tm.tenant', '=', 'td.tenant')
              .andOn('tm.tag_id', '=', 'td.tag_id');
        })
        .where('tm.mapping_id', id)
        .where('tm.tenant', tenant)
        .select(
          'tm.mapping_id as tag_id',
          'td.board_id',
          'td.tag_text',
          'tm.tagged_id',
          'tm.tagged_type',
          'td.background_color',
          'td.text_color',
          'tm.tenant',
          'tm.created_by',
          'tm.tag_id as definition_tag_id'
        )
        .first();

      if (!existingTag) {
        throw new Error(`Tag with id ${id} not found`);
      }

      // Check permissions
      // Map 'client' to 'client' for permission checks
      const entityResource = existingTag.tagged_type === 'client' ? 'client' : existingTag.tagged_type;

      if (!await hasPermissionAsync(currentUser, entityResource, 'update', trx)) {
        await throwPermissionErrorAsync(`update ${existingTag.tagged_type.replace('_', ' ')}`);
      }

      if (!await hasPermissionAsync(currentUser, 'tag', 'update', trx)) {
        await throwPermissionErrorAsync('update tags');
      }

      const previousTagText = String(existingTag.tag_text ?? '').trim();
      const nextTagText = typeof tag.tag_text === 'string' ? tag.tag_text.trim() : previousTagText;

      // Update the definition (only certain fields can be updated)
      await TagDefinition.update(trx, tenant, existingTag.definition_tag_id, {
        tag_text: tag.tag_text,
        background_color: tag.background_color,
        text_color: tag.text_color,
        board_id: tag.board_id
      });

      if (nextTagText && nextTagText !== previousTagText) {
        const occurredAt = new Date().toISOString();
        await publishWorkflowEvent({
          eventType: 'TAG_DEFINITION_UPDATED',
          payload: buildTagDefinitionUpdatedPayload({
            tagId: existingTag.definition_tag_id,
            previousName: previousTagText,
            newName: nextTagText,
            updatedByUserId: currentUser.user_id,
            updatedAt: occurredAt,
          }),
          ctx: {
            tenantId: tenant,
            occurredAt,
            actor: { actorType: 'USER', actorUserId: currentUser.user_id },
          },
        });
      }
    } catch (error) {
      console.error(`Error updating tag with id ${id}:`, error);
      if (error instanceof Error && error.message.includes('Permission denied')) {
        throw error;
      }
      throw new Error(`Failed to update tag with id ${id}`);
    }
  });
});

export const deleteTag = withAuth(async (currentUser: IUserWithRoles, { tenant }: AuthContext, id: string): Promise<void> => {
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Get existing tag to check entity type and creator (id is mapping_id)
      const existingTag = await trx('tag_mappings as tm')
        .join('tag_definitions as td', function() {
          this.on('tm.tenant', '=', 'td.tenant')
              .andOn('tm.tag_id', '=', 'td.tag_id');
        })
        .where('tm.mapping_id', id)
        .where('tm.tenant', tenant)
        .select(
          'tm.mapping_id as tag_id',
          'td.board_id',
          'td.tag_text',
          'tm.tagged_id',
          'tm.tagged_type',
          'td.background_color',
          'td.text_color',
          'tm.tenant',
          'tm.created_by',
          'tm.tag_id as definition_tag_id'
        )
        .first();

      if (!existingTag) {
        throw new Error(`Tag with id ${id} not found`);
      }

      // Check basic update permission for entity
      // Map 'client' to 'client' for permission checks
      const entityResource = existingTag.tagged_type === 'client' ? 'client' : existingTag.tagged_type;

      if (!await hasPermissionAsync(currentUser, entityResource, 'update', trx)) {
        await throwPermissionErrorAsync(`update ${existingTag.tagged_type.replace('_', ' ')}`);
      }

      // Check tag:delete permission for tags created by others
      // Permission model:
      // - Users with tag:delete permission can delete any tag
      // - Users without tag:delete permission can only delete tags they created
      // - Legacy tags (no created_by) can be deleted by anyone with entity update permission
      if (existingTag.created_by && existingTag.created_by !== currentUser.user_id) {
        if (!await hasPermissionAsync(currentUser, 'tag', 'delete', trx)) {
          await throwPermissionErrorAsync('delete this tag', 'You can only delete tags you created');
        }
      }

      // id is actually mapping_id - just delete the mapping
      // Note: Orphaned tag definitions are cleaned up by a nightly scheduled job
      await TagMapping.delete(trx, tenant, id);

      const occurredAt = new Date().toISOString();
      await publishWorkflowEvent({
        eventType: 'TAG_REMOVED',
        payload: buildTagRemovedPayload({
          tagId: existingTag.definition_tag_id,
          entityType: existingTag.tagged_type,
          entityId: existingTag.tagged_id,
          removedByUserId: currentUser.user_id,
          removedAt: occurredAt,
        }),
        ctx: {
          tenantId: tenant,
          occurredAt,
          actor: { actorType: 'USER', actorUserId: currentUser.user_id },
        },
      });
    } catch (error) {
      console.error(`Error deleting tag with id ${id}:`, error);
      if (error instanceof Error && error.message.includes('Permission denied')) {
        throw error;
      }
      throw new Error(`Failed to delete tag with id ${id}`);
    }
  });
});

export const findTagsByEntityIds = withAuth(async (_user: IUserWithRoles, { tenant }: AuthContext, entityIds: string[], entityType: TaggedEntityType): Promise<ITag[]> => {
  const { knex: db } = await createTenantKnex();
  try {
    if (entityIds.length === 0) {
      return [];
    }
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const tagsWithDefinitions = await TagMapping.getByEntities(trx, tenant, entityIds, entityType);
      return tagsWithDefinitions.map(tag => ({
        tag_id: tag.mapping_id,
        tenant,
        board_id: tag.board_id || undefined,
        tag_text: tag.tag_text,
        tagged_id: tag.tagged_id,
        tagged_type: tag.tagged_type,
        background_color: tag.background_color,
        text_color: tag.text_color
      }));
    });
  } catch (error) {
    console.error(`Error finding tags for ${entityType} ids: ${entityIds.join(', ')}:`, error);
    throw new Error(`Failed to find tags for ${entityType} ids: ${entityIds.join(', ')}`);
  }
});

export const getAllTags = withOptionalAuth(async (user: IUserWithRoles | null, ctx: AuthContext | null): Promise<ITag[]> => {
  try {
    if (!user || !ctx) {
      // Return empty array when no tenant context (e.g., during initial client render)
      console.warn('No tenant context available for getAllTags - returning empty array');
      return [];
    }

    const { knex: db } = await createTenantKnex();
    const { tenant } = ctx;
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // Join mappings with definitions to create ITag structure
      const tags = await trx('tag_mappings as tm')
        .join('tag_definitions as td', function() {
          this.on('tm.tenant', '=', 'td.tenant')
              .andOn('tm.tag_id', '=', 'td.tag_id');
        })
        .where('tm.tenant', tenant)
        .select(
          'tm.mapping_id as tag_id', // Use mapping_id as tag_id for backward compatibility
          'td.board_id',
          'td.tag_text',
          'tm.tagged_id',
          'tm.tagged_type',
          'td.background_color',
          'td.text_color',
          'tm.tenant'
        );

      return tags;
    });
  } catch (error) {
    console.error('Error getting all tags:', error);
    throw new Error('Failed to get all tags');
  }
});

export const findAllTagsByType = withOptionalAuth(async (user: IUserWithRoles | null, ctx: AuthContext | null, entityType: TaggedEntityType): Promise<ITag[]> => {
  try {
    if (!user || !ctx) {
      console.warn(`No tenant context available for findAllTagsByType(${entityType}) - returning empty array`);
      return [];
    }

    const { knex: db } = await createTenantKnex();
    const { tenant } = ctx;
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // Get tag definitions that have at least one mapping (filter out orphans)
      // Use DISTINCT ON for deduplication by tag_text (PostgreSQL-specific but works with Citus)
      const result = await trx.raw(`
        SELECT DISTINCT ON (td.tag_text) td.*
        FROM tag_definitions td
        WHERE td.tenant = ?
          AND td.tagged_type = ?
          AND EXISTS (
            SELECT 1 FROM tag_mappings tm
            WHERE tm.tenant = td.tenant AND tm.tag_id = td.tag_id
          )
        ORDER BY td.tag_text ASC, td.created_at ASC
      `, [tenant, entityType]);

      const definitions = result.rows || [];

      // Convert to ITag format (use definition ID as tag_id since these are unique)
      return definitions.map((def: any) => ({
        tag_id: def.tag_id,
        tenant,
        board_id: def.board_id || undefined,
        tag_text: def.tag_text,
        tagged_id: '', // No specific entity for unique tags
        tagged_type: def.tagged_type,
        background_color: def.background_color,
        text_color: def.text_color
      }));
    });
  } catch (error) {
    console.error(`Error finding all tags for type ${entityType}:`, error);
    throw new Error(`Failed to find all tags for type: ${entityType}`);
  }
});

/**
 * Creates multiple tags for a newly created entity.
 * Used by quick add forms to apply pending tags after entity creation.
 * Continues even if individual tags fail (logs error but doesn't throw).
 *
 * @param entityId - The ID of the newly created entity
 * @param entityType - The type of entity (client, contact, ticket, project, project_task)
 * @param pendingTags - Array of pending tags to create
 * @returns Array of successfully created tags
 */
export async function createTagsForEntity(
  entityId: string,
  entityType: TaggedEntityType,
  pendingTags: PendingTag[]
): Promise<ITag[]> {
  const createdTags: ITag[] = [];

  for (const tag of pendingTags) {
    try {
      const newTag = await createTag({
        tag_text: tag.tag_text,
        tagged_id: entityId,
        tagged_type: entityType,
        background_color: tag.background_color,
        text_color: tag.text_color,
      });
      createdTags.push(newTag);
    } catch (error) {
      console.error(`Failed to create tag "${tag.tag_text}" for ${entityType}:`, error);
      // Continue with other tags - don't fail the entire operation
    }
  }

  return createdTags;
}

/**
 * Creates multiple tags for an entity within an existing transaction.
 * Use this when creating tags as part of a larger transactional operation
 * to ensure atomicity (e.g., during imports where rollback should remove all data).
 *
 * @param trx - The Knex transaction to use
 * @param entityId - The ID of the entity to tag
 * @param entityType - The type of entity (client, contact, ticket, project, project_task)
 * @param pendingTags - Array of pending tags to create
 * @returns Array of successfully created tags
 */
export const createTagsForEntityWithTransaction = withAuth(async (
  currentUser: IUserWithRoles,
  _ctx: AuthContext,
  trx: Knex.Transaction,
  tenant: string,
  entityId: string,
  entityType: TaggedEntityType,
  pendingTags: PendingTag[]
): Promise<ITag[]> => {
  const userId = currentUser.user_id;

  const createdTags: ITag[] = [];

  for (const tag of pendingTags) {
    try {
      const tagText = tag.tag_text?.trim();
      if (!tagText) continue;

      // Validate length
      if (tagText.length > 50) {
        console.warn(`Tag text "${tagText}" too long, skipping`);
        continue;
      }

      // Determine colors
      let backgroundColor = tag.background_color;
      let textColor = tag.text_color;

      if (!backgroundColor || !textColor) {
        const colors = await generateEntityColorAsync(tagText);
        backgroundColor = backgroundColor || colors.backgroundColor;
        textColor = textColor || colors.textColor;
      }

      // Get or create tag definition
      const { definition, created: createdDefinition } = await TagDefinition.getOrCreateWithStatus(
        trx,
        tenant,
        tagText,
        entityType,
        {
          background_color: backgroundColor,
          text_color: textColor
        }
      );
      
      // Create mapping
      const mapping = await TagMapping.insert(trx, tenant, {
        tag_id: definition.tag_id,
        tagged_id: entityId,
        tagged_type: entityType
      }, userId);

      const occurredAt = new Date().toISOString();
      if (createdDefinition) {
        await publishWorkflowEvent({
          eventType: 'TAG_DEFINITION_CREATED',
          payload: buildTagDefinitionCreatedPayload({
            tagId: definition.tag_id,
            tagName: definition.tag_text,
            createdByUserId: userId,
            createdAt: definition.created_at ?? occurredAt,
          }),
          ctx: {
            tenantId: tenant,
            occurredAt,
            actor: { actorType: 'USER', actorUserId: userId },
          },
        });
      }

      await publishWorkflowEvent({
        eventType: 'TAG_APPLIED',
        payload: buildTagAppliedPayload({
          tagId: definition.tag_id,
          entityType,
          entityId,
          appliedByUserId: userId,
          appliedAt: mapping.created_at ?? occurredAt,
        }),
        ctx: {
          tenantId: tenant,
          occurredAt,
          actor: { actorType: 'USER', actorUserId: userId },
        },
      });

      createdTags.push({
        tag_id: mapping.mapping_id,
        tenant,
        tag_text: tagText,
        tagged_id: entityId,
        tagged_type: entityType,
        background_color: backgroundColor,
        text_color: textColor
      });
    } catch (error) {
      console.error(`Failed to create tag "${tag.tag_text}" for ${entityType}:`, error);
      // Continue with other tags - don't fail the entire operation
    }
  }

  return createdTags;
});

export const updateTagColor = withAuth(async (currentUser: IUserWithRoles, { tenant }: AuthContext, tagId: string, backgroundColor: string | null, textColor: string | null): Promise<{ tag_text: string; background_color: string | null; text_color: string | null; }> => {
  const { knex: db } = await createTenantKnex();

  // Validate hex color codes if provided
  const hexColorRegex = /^#[0-9A-F]{6}$/i;
  if (backgroundColor && !hexColorRegex.test(backgroundColor)) {
    throw new Error('Invalid background color format. Must be a valid hex color code (e.g., #FF0000)');
  }
  if (textColor && !hexColorRegex.test(textColor)) {
    throw new Error('Invalid text color format. Must be a valid hex color code (e.g., #FFFFFF)');
  }

  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // tagId is actually mapping_id in the new system
      const tag = await trx('tag_mappings as tm')
        .join('tag_definitions as td', function() {
          this.on('tm.tenant', '=', 'td.tenant')
              .andOn('tm.tag_id', '=', 'td.tag_id');
        })
        .where('tm.mapping_id', tagId)
        .where('tm.tenant', tenant)
        .select(
          'tm.mapping_id as tag_id',
          'td.board_id',
          'td.tag_text',
          'tm.tagged_id',
          'tm.tagged_type',
          'td.background_color',
          'td.text_color',
          'tm.tenant'
        )
        .first();

      if (!tag) {
        throw new Error(`Tag with id ${tagId} not found`);
      }

      // Check permissions
      // Map 'client' to 'client' for permission checks
      const entityResource = tag.tagged_type === 'client' ? 'client' : tag.tagged_type;

      if (!await hasPermissionAsync(currentUser, entityResource, 'update', trx)) {
        await throwPermissionErrorAsync(`update ${tag.tagged_type.replace('_', ' ')}`);
      }

      if (!await hasPermissionAsync(currentUser, 'tag', 'update', trx)) {
        await throwPermissionErrorAsync('update tag colors');
      }

      // Find the definition and update it
      const definition = await TagDefinition.findByTextAndType(trx, tenant, tag.tag_text, tag.tagged_type);
      if (definition) {
        await TagDefinition.update(trx, tenant, definition.tag_id, {
          background_color: backgroundColor,
          text_color: textColor
        });
      }
      return {
        tag_text: tag.tag_text,
        background_color: backgroundColor,
        text_color: textColor,
      };
    });
  } catch (error) {
    console.error(`Error updating tag color for tag id ${tagId}:`, error);
    if (error instanceof Error && error.message.includes('Permission denied')) {
      throw error;
    }
    throw new Error(`Failed to update tag color for tag id ${tagId}`);
  }
});

export const updateTagText = withAuth(async (currentUser: IUserWithRoles, { tenant }: AuthContext, tagId: string, newTagText: string): Promise<{ old_tag_text: string; new_tag_text: string; tagged_type: TaggedEntityType; updated_count: number; }> => {
  const { knex: db } = await createTenantKnex();

  // Validate tag text
  if (!newTagText || !newTagText.trim()) {
    throw new Error('Tag text cannot be empty');
  }

  const trimmedNewText = newTagText.trim();

  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // tagId is actually mapping_id in the new system
      const tag = await trx('tag_mappings as tm')
        .join('tag_definitions as td', function() {
          this.on('tm.tenant', '=', 'td.tenant')
              .andOn('tm.tag_id', '=', 'td.tag_id');
        })
        .where('tm.mapping_id', tagId)
        .where('tm.tenant', tenant)
        .select(
          'tm.mapping_id as tag_id',
          'td.board_id',
          'td.tag_text',
          'tm.tagged_id',
          'tm.tagged_type',
          'td.background_color',
          'td.text_color',
          'tm.tenant'
        )
        .first();

      if (!tag) {
        throw new Error(`Tag with id ${tagId} not found`);
      }

      // Check permissions
      // Map 'client' to 'client' for permission checks
      const entityResource = tag.tagged_type === 'client' ? 'client' : tag.tagged_type;

      if (!await hasPermissionAsync(currentUser, entityResource, 'update', trx)) {
        await throwPermissionErrorAsync(`update ${tag.tagged_type.replace('_', ' ')}`);
      }

      if (!await hasPermissionAsync(currentUser, 'tag', 'update', trx)) {
        await throwPermissionErrorAsync('update tag text');
      }

      // Don't update if text is the same
      if (tag.tag_text === trimmedNewText) {
        return {
          old_tag_text: tag.tag_text,
          new_tag_text: trimmedNewText,
          tagged_type: tag.tagged_type,
          updated_count: 0,
        };
      }

      // Find the old definition
      const oldDefinition = await TagDefinition.findByTextAndType(trx, tenant, tag.tag_text, tag.tagged_type);

      if (!oldDefinition) {
        return {
          old_tag_text: tag.tag_text,
          new_tag_text: trimmedNewText,
          tagged_type: tag.tagged_type,
          updated_count: 0,
        };
      }

      // Check if new tag text already exists
      const newDefinition = await TagDefinition.findByTextAndType(trx, tenant, trimmedNewText, tag.tagged_type);

      if (newDefinition) {
        throw new Error(`Tag "${trimmedNewText}" already exists for ${tag.tagged_type} entities`);
      }

      // Update the definition
      await TagDefinition.update(trx, tenant, oldDefinition.tag_id, {
        tag_text: trimmedNewText
      });

      const occurredAt = new Date().toISOString();
      await publishWorkflowEvent({
        eventType: 'TAG_DEFINITION_UPDATED',
        payload: buildTagDefinitionUpdatedPayload({
          tagId: oldDefinition.tag_id,
          previousName: tag.tag_text,
          newName: trimmedNewText,
          updatedByUserId: currentUser.user_id,
          updatedAt: occurredAt,
        }),
        ctx: {
          tenantId: tenant,
          occurredAt,
          actor: { actorType: 'USER', actorUserId: currentUser.user_id },
        },
      });


      // Return count of affected mappings
      const updatedCount = await TagMapping.getUsageCount(trx, tenant, oldDefinition.tag_id);

      return {
        old_tag_text: tag.tag_text,
        new_tag_text: trimmedNewText,
        tagged_type: tag.tagged_type,
        updated_count: updatedCount,
      };
    });
  } catch (error) {
    console.error(`Error updating tag text for tag id ${tagId}:`, error);
    if (error instanceof Error && (error.message.includes('already exists') || error.message.includes('Permission denied'))) {
      throw error;
    }
    throw new Error(`Failed to update tag text for tag id ${tagId}`);
  }
});

export const checkTagPermissions = withOptionalAuth(async (currentUser: IUserWithRoles | null, _ctx: AuthContext | null, taggedType: TaggedEntityType): Promise<{
  canAddExisting: boolean;
  canCreateNew: boolean;
  canEditColors: boolean;
  canEditText: boolean;
  canDelete: boolean;
  canDeleteAll: boolean;
}> => {
  try {
    if (!currentUser) {
      return {
        canAddExisting: false,
        canCreateNew: false,
        canEditColors: false,
        canEditText: false,
        canDelete: false,
        canDeleteAll: false
      };
    }

    const { knex: db } = await createTenantKnex();

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // Map 'client' to 'client' for permission checks
      const permissionEntity = taggedType === 'client' ? 'client' : taggedType;

      // Check all permissions in parallel
      const [entityUpdate, tagCreate, tagUpdate, tagDelete] = await Promise.all([
        hasPermissionAsync(currentUser, permissionEntity, 'update', trx),
        hasPermissionAsync(currentUser, 'tag', 'create', trx),
        hasPermissionAsync(currentUser, 'tag', 'update', trx),
        hasPermissionAsync(currentUser, 'tag', 'delete', trx)
      ]);

      return {
        canAddExisting: entityUpdate,
        canCreateNew: entityUpdate && tagCreate,
        canEditColors: entityUpdate && tagUpdate,
        canEditText: entityUpdate && tagUpdate,
        canDelete: entityUpdate,
        canDeleteAll: entityUpdate && tagDelete
      };
    });
  } catch (error) {
    console.error('Error checking tag permissions:', error);
    // Return no permissions on error
    return {
      canAddExisting: false,
      canCreateNew: false,
      canEditColors: false,
      canEditText: false,
      canDelete: false,
      canDeleteAll: false
    };
  }
});

export const deleteAllTagsByText = withAuth(async (currentUser: IUserWithRoles, { tenant }: AuthContext, tagText: string, taggedType: TaggedEntityType): Promise<{ deleted_count: number }> => {
  const { knex: db } = await createTenantKnex();

  // Validate tag text
  if (!tagText || !tagText.trim()) {
    throw new Error('Tag text cannot be empty');
  }

  const trimmedText = tagText.trim();

  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // Check permissions
      // Map 'client' to 'client' for permission checks
      const entityResource = taggedType === 'client' ? 'client' : taggedType;

      if (!await hasPermissionAsync(currentUser, entityResource, 'update', trx)) {
        await throwPermissionErrorAsync(`update ${taggedType.replace('_', ' ')}`);
      }

      if (!await hasPermissionAsync(currentUser, 'tag', 'delete', trx)) {
        await throwPermissionErrorAsync('delete all instances of tags');
      }

      // Find the definition and delete it (mappings will cascade delete)
      const definition = await TagDefinition.findByTextAndType(trx, tenant, trimmedText, taggedType);

      if (!definition) {
        return {
          deleted_count: 0,
        };
      }

      // Get count before deletion
      const deletedCount = await TagMapping.getUsageCount(trx, tenant, definition.tag_id);

      // Delete the definition (mappings will cascade delete)
      await TagDefinition.delete(trx, tenant, definition.tag_id);

      return {
        deleted_count: deletedCount,
      };
    });
  } catch (error) {
    console.error(`Error deleting tags with text "${tagText}" and type ${taggedType}:`, error);
    if (error instanceof Error && error.message.includes('Permission denied')) {
      throw error;
    }
    throw new Error(`Failed to delete tags with text "${tagText}"`);
  }
});
