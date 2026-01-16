'use server'

import TagDefinition, { ITagDefinition } from 'server/src/lib/models/tagDefinition';
import TagMapping, { ITagMapping, ITagWithDefinition } from 'server/src/lib/models/tagMapping';
import { ITag, TaggedEntityType, PendingTag } from 'server/src/interfaces/tag.interfaces';
import { withTransaction } from '@alga-psa/shared/db';
import { createTenantKnex, getCurrentTenantId } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { throwPermissionError } from 'server/src/lib/utils/errorHandling';
import { Knex } from 'knex';
import { TagModel, CreateTagInput } from '@alga-psa/shared/models/tagModel';

export async function findTagsByEntityId(entityId: string, entityType: string): Promise<ITag[]> {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const tagsWithDefinitions = await TagMapping.getByEntity(trx, entityId, entityType as TaggedEntityType);
      const tenant = await getCurrentTenantId() || '';
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
}

export async function findTagById(tagId: string): Promise<ITag | undefined> {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      
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
}

export async function createTag(tag: Omit<ITag, 'tag_id' | 'tenant'>): Promise<ITag> {
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
  if (!/^[a-zA-Z0-9\-_\s!@#$%^&*()+=\[\]{};':",./<>?]+$/.test(tagText)) {
    throw new Error('Tag text contains invalid characters');
  }
  
  const { knex: db } = await createTenantKnex();
  
  // Get current user for created_by field and permission check
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not found');
  }
  const userId = currentUser.user_id;
  
  return await withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Check permissions
      // Convert tagged_type to resource name (e.g., 'project_task' -> 'project_task')
      // Map 'client' to 'client' for permission checks
      const entityResource = tag.tagged_type === 'client' ? 'client' : tag.tagged_type;
      
      if (!await hasPermission(currentUser, entityResource, 'update', trx)) {
        throwPermissionError(`update ${tag.tagged_type.replace('_', ' ')}`);
      }
      
      const existingTags = await TagDefinition.getAllByType(trx, tag.tagged_type);
      const existingTag = existingTags.find((t: ITagDefinition) => t.tag_text === tagText);
      
      // Check if this is a new tag (not in existing tags) - only then require tag:create permission
      if (!existingTag && !await hasPermission(currentUser, 'tag', 'create', trx)) {
        throwPermissionError('create new tags', 'You can only select from existing tags');
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
        const { generateEntityColor } = await import('server/src/utils/colorUtils');
        const colors = generateEntityColor(tagText);
        tagWithTenant.background_color = tagWithTenant.background_color || colors.background;
        tagWithTenant.text_color = tagWithTenant.text_color || colors.text;
      }

      // Get or create tag definition
      const definition = await TagDefinition.getOrCreate(
        trx,
        tagText,
        tagWithTenant.tagged_type,
        {
          board_id: tagWithTenant.board_id,
          background_color: tagWithTenant.background_color,
          text_color: tagWithTenant.text_color
        }
      );
      
      // Create mapping with user ID
      const mapping = await TagMapping.insert(trx, {
        tag_id: definition.tag_id,
        tagged_id: tagWithTenant.tagged_id,
        tagged_type: tagWithTenant.tagged_type
      }, userId);
      
      const createdTag: ITag = { 
        ...tagWithTenant, 
        tag_id: mapping.mapping_id, // Return mapping_id as tag_id for backward compatibility
        tenant: await getCurrentTenantId() || ''
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
}

export async function updateTag(id: string, tag: Partial<ITag>): Promise<void> {
  const { knex: db } = await createTenantKnex();
  
  // Get current user for permission check
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not found');
  }
  
  return await withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Get existing tag to check entity type (id is mapping_id)
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      
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
      
      if (!await hasPermission(currentUser, entityResource, 'update', trx)) {
        throwPermissionError(`update ${existingTag.tagged_type.replace('_', ' ')}`);
      }
      
      if (!await hasPermission(currentUser, 'tag', 'update', trx)) {
        throwPermissionError('update tags');
      }
      
      // Update the definition (only certain fields can be updated)
      await TagDefinition.update(trx, existingTag.definition_tag_id, {
        tag_text: tag.tag_text,
        background_color: tag.background_color,
        text_color: tag.text_color,
        board_id: tag.board_id
      });
    } catch (error) {
      console.error(`Error updating tag with id ${id}:`, error);
      if (error instanceof Error && error.message.includes('Permission denied')) {
        throw error;
      }
      throw new Error(`Failed to update tag with id ${id}`);
    }
  });
}

export async function deleteTag(id: string): Promise<void> {
  const { knex: db } = await createTenantKnex();
  
  // Get current user for permission check
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not found');
  }
  
  return await withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Get existing tag to check entity type and creator (id is mapping_id)
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      
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
          'tm.created_by'
        )
        .first();
        
      if (!existingTag) {
        throw new Error(`Tag with id ${id} not found`);
      }
      
      // Check basic update permission for entity
      // Map 'client' to 'client' for permission checks
      const entityResource = existingTag.tagged_type === 'client' ? 'client' : existingTag.tagged_type;
      
      if (!await hasPermission(currentUser, entityResource, 'update', trx)) {
        throwPermissionError(`update ${existingTag.tagged_type.replace('_', ' ')}`);
      }
      
      // Check if user created the tag (only creator can delete individual tags)
      // If created_by is not set (legacy tags), allow deletion for backward compatibility
      if (existingTag.created_by && existingTag.created_by !== currentUser.user_id) {
        throwPermissionError('delete this tag', 'You can only delete tags you created');
      }
      
      // id is actually mapping_id - just delete the mapping
      await TagMapping.delete(trx, id);
    } catch (error) {
      console.error(`Error deleting tag with id ${id}:`, error);
      if (error instanceof Error && error.message.includes('Permission denied')) {
        throw error;
      }
      throw new Error(`Failed to delete tag with id ${id}`);
    }
  });
}

export async function findTagsByEntityIds(entityIds: string[], entityType: TaggedEntityType): Promise<ITag[]> {
  const { knex: db } = await createTenantKnex();
  try {
    if (entityIds.length === 0) {
      return [];
    }
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const tagsWithDefinitions = await TagMapping.getByEntities(trx, entityIds, entityType);
      const tenant = await getCurrentTenantId() || '';
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
}

export async function getAllTags(): Promise<ITag[]> {
  try {
    const { knex: db } = await createTenantKnex();
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        // Return empty array when no tenant context (e.g., during initial client render)
        console.warn('No tenant context available for getAllTags - returning empty array');
        return [];
      }
      
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
}

export async function findAllTagsByType(entityType: TaggedEntityType): Promise<ITag[]> {
  try {
    const { knex: db } = await createTenantKnex();
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        console.warn(`No tenant context available for findAllTagsByType(${entityType}) - returning empty array`);
        return [];
      }
      
      const definitions = await TagDefinition.getAllByType(trx, entityType);
      
      // Convert to ITag format (use definition ID as tag_id since these are unique)
      return definitions.map(def => ({
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
}

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
export async function createTagsForEntityWithTransaction(
  trx: Knex.Transaction,
  entityId: string,
  entityType: TaggedEntityType,
  pendingTags: PendingTag[]
): Promise<ITag[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not found');
  }
  const userId = currentUser.user_id;
  const tenant = await getCurrentTenantId() || '';

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
        const { generateEntityColor } = await import('server/src/utils/colorUtils');
        const colors = generateEntityColor(tagText);
        backgroundColor = backgroundColor || colors.background;
        textColor = textColor || colors.text;
      }

      // Get or create tag definition
      const definition = await TagDefinition.getOrCreate(
        trx,
        tagText,
        entityType,
        {
          background_color: backgroundColor,
          text_color: textColor
        }
      );

      // Create mapping
      const mapping = await TagMapping.insert(trx, {
        tag_id: definition.tag_id,
        tagged_id: entityId,
        tagged_type: entityType
      }, userId);

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
}

export async function updateTagColor(tagId: string, backgroundColor: string | null, textColor: string | null): Promise<{ tag_text: string; background_color: string | null; text_color: string | null; }> {
  const { knex: db } = await createTenantKnex();
  
  // Get current user for permission check
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not found');
  }
  
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
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      
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
      
      if (!await hasPermission(currentUser, entityResource, 'update', trx)) {
        throwPermissionError(`update ${tag.tagged_type.replace('_', ' ')}`);
      }
      
      if (!await hasPermission(currentUser, 'tag', 'update', trx)) {
        throwPermissionError('update tag colors');
      }
      
      // Find the definition and update it
      const definition = await TagDefinition.findByTextAndType(trx, tag.tag_text, tag.tagged_type);
      if (definition) {
        await TagDefinition.update(trx, definition.tag_id, {
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
}

export async function updateTagText(tagId: string, newTagText: string): Promise<{ old_tag_text: string; new_tag_text: string; tagged_type: TaggedEntityType; updated_count: number; }> {
  const { knex: db } = await createTenantKnex();
  
  // Get current user for permission check
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not found');
  }
  
  // Validate tag text
  if (!newTagText || !newTagText.trim()) {
    throw new Error('Tag text cannot be empty');
  }
  
  const trimmedNewText = newTagText.trim();
  
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      
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
      
      if (!await hasPermission(currentUser, entityResource, 'update', trx)) {
        throwPermissionError(`update ${tag.tagged_type.replace('_', ' ')}`);
      }
      
      if (!await hasPermission(currentUser, 'tag', 'update', trx)) {
        throwPermissionError('update tag text');
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
      const oldDefinition = await TagDefinition.findByTextAndType(trx, tag.tag_text, tag.tagged_type);
      
      if (!oldDefinition) {
        return {
          old_tag_text: tag.tag_text,
          new_tag_text: trimmedNewText,
          tagged_type: tag.tagged_type,
          updated_count: 0,
        };
      }
      
      // Check if new tag text already exists
      const newDefinition = await TagDefinition.findByTextAndType(trx, trimmedNewText, tag.tagged_type);
      
      if (newDefinition) {
        throw new Error(`Tag "${trimmedNewText}" already exists for ${tag.tagged_type} entities`);
      }
      
      // Update the definition
      await TagDefinition.update(trx, oldDefinition.tag_id, {
        tag_text: trimmedNewText
      });
      
      // Return count of affected mappings
      const updatedCount = await TagMapping.getUsageCount(trx, oldDefinition.tag_id);
      
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
}

export async function checkTagPermissions(taggedType: TaggedEntityType): Promise<{
  canAddExisting: boolean;
  canCreateNew: boolean;
  canEditColors: boolean;
  canEditText: boolean;
  canDelete: boolean;
  canDeleteAll: boolean;
}> {
  try {
    const currentUser = await getCurrentUser();
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
        hasPermission(currentUser, permissionEntity, 'update', trx),
        hasPermission(currentUser, 'tag', 'create', trx),
        hasPermission(currentUser, 'tag', 'update', trx),
        hasPermission(currentUser, 'tag', 'delete', trx)
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
}

export async function deleteAllTagsByText(tagText: string, taggedType: TaggedEntityType): Promise<{ deleted_count: number }> {
  const { knex: db } = await createTenantKnex();
  
  // Get current user for permission check
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not found');
  }
  
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
      
      if (!await hasPermission(currentUser, entityResource, 'update', trx)) {
        throwPermissionError(`update ${taggedType.replace('_', ' ')}`);
      }
      
      if (!await hasPermission(currentUser, 'tag', 'delete', trx)) {
        throwPermissionError('delete all instances of tags');
      }
      
      // Find the definition and delete it (mappings will cascade delete)
      const definition = await TagDefinition.findByTextAndType(trx, trimmedText, taggedType);
      
      if (!definition) {
        return {
          deleted_count: 0,
        };
      }
      
      // Get count before deletion
      const deletedCount = await TagMapping.getUsageCount(trx, definition.tag_id);
      
      // Delete the definition (mappings will cascade delete)
      await TagDefinition.delete(trx, definition.tag_id);
      
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
}
