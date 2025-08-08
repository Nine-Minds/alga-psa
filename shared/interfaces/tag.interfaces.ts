/**
 * Canonical Tag Interfaces
 * These are the canonical definitions for tag-related types used across the codebase.
 * All references should use these definitions unless there's a specific reason not to.
 */

/**
 * Types of entities that can be tagged
 */
export type TaggedEntityType = 'company' | 'contact' | 'project_task' | 'document' | 'knowledge_base_article';

/**
 * Tag definition entity interface
 */
export interface TagDefinition {
  tag_id: string;
  tenant?: string;
  tag_text: string;
  tagged_type: TaggedEntityType;
  channel_id?: string | null;
  background_color?: string | null;
  text_color?: string | null;
  created_at: string;
}

/**
 * Tag mapping entity interface
 */
export interface TagMapping {
  mapping_id: string;
  tenant?: string;
  tag_id: string;
  tagged_id: string;
  tagged_type: TaggedEntityType;
  created_by?: string | null;
  created_at: string;
}

/**
 * Input type for creating a new tag
 */
export interface CreateTagInput {
  tag_text: string;
  tagged_id: string;
  tagged_type: TaggedEntityType;
  channel_id?: string;
  background_color?: string | null;
  text_color?: string | null;
  created_by?: string;
}

/**
 * Output type for tag creation
 */
export interface CreateTagOutput {
  tag_id: string;
  mapping_id: string;
  tag_text: string;
  tagged_id: string;
  tagged_type: TaggedEntityType;
  tenant?: string;
  created_at: string;
}