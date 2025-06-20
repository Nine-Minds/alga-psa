'use server'

import Tag from 'server/src/lib/models/tag';
import { ITag, TaggedEntityType } from 'server/src/interfaces/tag.interfaces';
import { withTransaction } from '@shared/db';
import { createTenantKnex } from 'server/src/lib/db';
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
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const existingTags = await Tag.getAllUniqueTagsByType(trx, tag.tagged_type);
      const existingTag = existingTags.find(t => t.tag_text === tag.tag_text);

      const tagWithTenant = { ...tag };

      if (existingTag && (existingTag.background_color || existingTag.text_color)) {
        tagWithTenant.background_color = existingTag.background_color;
        tagWithTenant.text_color = existingTag.text_color;
      }

      const newTagId = await Tag.insert(trx, tagWithTenant);
      return { ...tagWithTenant, tag_id: newTagId.tag_id };
    });
  } catch (error) {
    console.error(`Error creating tag:`, error);
    throw new Error(`Failed to create tag`);
  }
}

export async function updateTag(id: string, tag: Partial<ITag>): Promise<void> {
  const { knex: db } = await createTenantKnex();
  try {
    await withTransaction(db, async (trx: Knex.Transaction) => {
      await Tag.update(trx, id, tag);
    });
  } catch (error) {
    console.error(`Error updating tag with id ${id}:`, error);
    throw new Error(`Failed to update tag with id ${id}`);
  }
}

export async function deleteTag(id: string): Promise<void> {
  const { knex: db } = await createTenantKnex();
  try {
    await withTransaction(db, async (trx: Knex.Transaction) => {
      await Tag.delete(trx, id);
    });
  } catch (error) {
    console.error(`Error deleting tag with id ${id}:`, error);
    throw new Error(`Failed to delete tag with id ${id}`);
  }
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
      
      await Tag.updateColorByText(trx, tag.tag_text, tag.tagged_type, backgroundColor, textColor);
      return {
        tag_text: tag.tag_text,
        background_color: backgroundColor,
        text_color: textColor,
      };
    });
  } catch (error) {
    console.error(`Error updating tag color for tag id ${tagId}:`, error);
    throw new Error(`Failed to update tag color for tag id ${tagId}`);
  }
}
