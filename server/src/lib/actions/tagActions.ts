'use server'

import Tag from 'server/src/lib/models/tag';
import { ITag, TaggedEntityType } from 'server/src/interfaces/tag.interfaces';

export async function findTagsByEntityId(entityId: string, entityType: TaggedEntityType): Promise<ITag[]> {
  try {
    const tags = await Tag.getAllByEntityId(entityId, entityType);
    return tags;
  } catch (error) {
    console.error(`Error finding tags for ${entityType} id ${entityId}:`, error);
    throw new Error(`Failed to find tags for ${entityType} id: ${entityId}`);
  }
}

export async function findTagById(tagId: string): Promise<ITag | undefined> {
  try {
    const tag = await Tag.get(tagId);
    if (!tag) {
      console.warn(`Tag with id ${tagId} not found`);
    }
    return tag;
  } catch (error) {
    console.error(`Error finding tag with id ${tagId}:`, error);
    throw new Error(`Failed to find tag with id: ${tagId}`);
  }
}

export async function createTag(tag: Omit<ITag, 'tag_id' | 'tenant'>): Promise<ITag> {
  try {
    const tagWithTenant = { ...tag };
    const newTagId = await Tag.insert(tagWithTenant);
    return { ...tagWithTenant, tag_id: newTagId.tag_id };
  } catch (error) {
    console.error(`Error creating tag:`, error);
    throw new Error(`Failed to create tag`);
  }
}

export async function updateTag(id: string, tag: Partial<ITag>): Promise<void> {
  try {
    await Tag.update(id, tag);
  } catch (error) {
    console.error(`Error updating tag with id ${id}:`, error);
    throw new Error(`Failed to update tag with id ${id}`);
  }
}

export async function deleteTag(id: string): Promise<void> {
  try {
    await Tag.delete(id);
  } catch (error) {
    console.error(`Error deleting tag with id ${id}:`, error);
    throw new Error(`Failed to delete tag with id ${id}`);
  }
}

export async function findTagsByEntityIds(entityIds: string[], entityType: TaggedEntityType): Promise<ITag[]> {
  try {
    if (entityIds.length === 0) {
      return [];
    }
    const tags = await Tag.getAllByEntityIds(entityIds, entityType);
    return tags;
  } catch (error) {
    console.error(`Error finding tags for ${entityType} ids: ${entityIds.join(', ')}:`, error);
    throw new Error(`Failed to find tags for ${entityType} ids: ${entityIds.join(', ')}`);
  }
}

export async function getAllTags(): Promise<ITag[]> {
  try {
    const tags = await Tag.getAll();
    return tags;
  } catch (error) {
    console.error('Error getting all tags:', error);
    throw new Error('Failed to get all tags');
  }
}

export async function findAllTagsByType(entityType: TaggedEntityType): Promise<string[]> {
  try {
    const tagTexts = await Tag.getAllUniqueTagTextsByType(entityType);
    return tagTexts;
  } catch (error) {
    console.error(`Error finding all tag texts for type ${entityType}:`, error);
    throw new Error(`Failed to find all tag texts for type: ${entityType}`);
  }
}
