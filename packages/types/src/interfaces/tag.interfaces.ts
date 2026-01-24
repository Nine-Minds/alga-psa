/**
 * Canonical Tag Interfaces
 * These are the canonical definitions for tag-related types used across the codebase.
 * All references should use these definitions unless there's a specific reason not to.
 */

/**
 * Types of entities that can be tagged
 */
export type TaggedEntityType = 'client' | 'contact' | 'ticket' | 'project' | 'project_task' | 'workflow_form' | 'document' | 'knowledge_base_article';

/**
 * Tag entity with full details
 */
export interface ITag {
  tag_id: string;
  tenant?: string;
  board_id?: string;
  tag_text: string;
  tagged_id: string;
  tagged_type: TaggedEntityType;
  background_color?: string | null;
  text_color?: string | null;
  created_by?: string | null;
}

/**
 * Interface for entities that can have tags attached
 */
export interface ITaggable {
  tags?: ITag[];
}

/**
 * Represents a tag that is pending creation (selected in quick add form but not yet persisted).
 */
export interface PendingTag {
  tag_text: string;
  tag_id?: string;
  background_color?: string | null;
  text_color?: string | null;
  isNew: boolean;
}

/**
 * Tag definition entity interface
 */
export interface TagDefinition {
  tag_id: string;
  tenant?: string;
  tag_text: string;
  tagged_type: TaggedEntityType;
  board_id?: string | null;
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
  board_id?: string;
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