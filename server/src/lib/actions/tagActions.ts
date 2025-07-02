'use server'

import Tag from 'server/src/lib/models/tagConfig';
import { ITag, TaggedEntityType } from 'server/src/interfaces/tag.interfaces';
import { withTransaction } from '@shared/db';
import { createTenantKnex, getCurrentTenantId } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { throwPermissionError } from 'server/src/lib/utils/errorHandling';
import { Knex } from 'knex';

export async function findTagsByEntityId(entityId: string, entityType: string): Promise<ITag[]> {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const tags = await Tag.getAllByEntityId(trx, entityId, entityType as TaggedEntityType);
      return tags;
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
      const tag = await Tag.get(trx, tagId);
      if (!tag) {
        console.warn(`Tag with id ${tagId} not found`);
      }
      return tag;
    });
  } catch (error) {
    console.error(`Error finding tag with id ${tagId}:`, error);
    throw new Error(`Failed to find tag with id: ${tagId}`);
  }
}

export async function createTag(tag: Omit<ITag, 'tag_id' | 'tenant'>): Promise<ITag> {
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
      const entityResource = tag.tagged_type;
      
      if (!await hasPermission(currentUser, entityResource, 'update', trx)) {
        throwPermissionError(`update ${tag.tagged_type.replace('_', ' ')}`);
      }
      
      const existingTags = await Tag.getAllUniqueTagsByType(trx, tag.tagged_type);
      const existingTag = existingTags.find(t => t.tag_text === tag.tag_text);
      
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
        const colors = generateEntityColor(tag.tag_text);
        tagWithTenant.background_color = tagWithTenant.background_color || colors.background;
        tagWithTenant.text_color = tagWithTenant.text_color || colors.text;
      }

      const newTagId = await Tag.insert(trx, tagWithTenant, userId);
      const createdTag: ITag = { 
        ...tagWithTenant, 
        tag_id: newTagId.tag_id,
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
      // Get existing tag to check entity type
      const existingTag = await Tag.get(trx, id);
      if (!existingTag) {
        throw new Error(`Tag with id ${id} not found`);
      }
      
      // Check permissions
      const entityResource = existingTag.tagged_type;
      
      if (!await hasPermission(currentUser, entityResource, 'update', trx)) {
        throwPermissionError(`update ${existingTag.tagged_type.replace('_', ' ')}`);
      }
      
      if (!await hasPermission(currentUser, 'tag', 'update', trx)) {
        throwPermissionError('update tags');
      }
      
      await Tag.update(trx, id, tag);
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
      // Get existing tag to check entity type and creator
      const existingTag = await Tag.get(trx, id);
      if (!existingTag) {
        throw new Error(`Tag with id ${id} not found`);
      }
      
      // Check basic update permission for entity
      const entityResource = existingTag.tagged_type;
      
      if (!await hasPermission(currentUser, entityResource, 'update', trx)) {
        throwPermissionError(`update ${existingTag.tagged_type.replace('_', ' ')}`);
      }
      
      // Check if user created the tag (only creator can delete individual tags)
      // If created_by is not set (legacy tags), allow deletion for backward compatibility
      if (existingTag.created_by && existingTag.created_by !== currentUser.user_id) {
        throwPermissionError('delete this tag', 'You can only delete tags you created');
      }
      
      await Tag.delete(trx, id);
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
      const tags = await Tag.getAllByEntityIds(trx, entityIds, entityType);
      return tags;
    });
  } catch (error) {
    console.error(`Error finding tags for ${entityType} ids: ${entityIds.join(', ')}:`, error);
    throw new Error(`Failed to find tags for ${entityType} ids: ${entityIds.join(', ')}`);
  }
}

export async function getAllTags(): Promise<ITag[]> {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const tags = await Tag.getAll(trx);
      return tags;
    });
  } catch (error) {
    console.error('Error getting all tags:', error);
    throw new Error('Failed to get all tags');
  }
}

export async function findAllTagsByType(entityType: TaggedEntityType): Promise<ITag[]> {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const tags = await Tag.getAllUniqueTagsByType(trx, entityType);
      return tags;
    });
  } catch (error) {
    console.error(`Error finding all tags for type ${entityType}:`, error);
    throw new Error(`Failed to find all tags for type: ${entityType}`);
  }
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
      const tag = await Tag.get(trx, tagId);
      if (!tag) {
        throw new Error(`Tag with id ${tagId} not found`);
      }
      
      // Check permissions
      const entityResource = tag.tagged_type;
      
      if (!await hasPermission(currentUser, entityResource, 'update', trx)) {
        throwPermissionError(`update ${tag.tagged_type.replace('_', ' ')}`);
      }
      
      if (!await hasPermission(currentUser, 'tag', 'update', trx)) {
        throwPermissionError('update tag colors');
      }
      
      await Tag.updateColorByText(trx, tag.tag_text, tag.tagged_type, backgroundColor, textColor);
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
      const tag = await Tag.get(trx, tagId);
      if (!tag) {
        throw new Error(`Tag with id ${tagId} not found`);
      }
      
      // Check permissions
      const entityResource = tag.tagged_type;
      
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
      
      const updatedCount = await Tag.updateTextByText(trx, tag.tag_text, trimmedNewText, tag.tagged_type);
      
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
      // Check all permissions in parallel
      const [entityUpdate, tagCreate, tagUpdate, tagDelete] = await Promise.all([
        hasPermission(currentUser, taggedType, 'update', trx),
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
      const entityResource = taggedType;
      
      if (!await hasPermission(currentUser, entityResource, 'update', trx)) {
        throwPermissionError(`update ${taggedType.replace('_', ' ')}`);
      }
      
      if (!await hasPermission(currentUser, 'tag', 'delete', trx)) {
        throwPermissionError('delete all instances of tags');
      }
      
      const deletedCount = await Tag.deleteByText(trx, trimmedText, taggedType);
      
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
