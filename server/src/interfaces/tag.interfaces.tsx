import { TenantEntity } from ".";

// Server-specific TaggedEntityType includes additional types not in shared
export type TaggedEntityType = 'contact' | 'client' | 'ticket' | 'project' | 'project_task' | 'workflow_form' | 'document' | 'knowledge_base_article';

// ITag represents a tag in the server context
export interface ITag extends TenantEntity {
  tag_id: string;
  board_id?: string;
  tag_text: string;
  tagged_id: string;
  tagged_type: TaggedEntityType;
  background_color?: string | null;
  text_color?: string | null;
  created_by?: string | null;
}

export interface ITaggable {
  tags?: ITag[];
}

/**
 * Represents a tag that is pending creation (selected in quick add form but not yet persisted).
 * Used by quick add forms where the entity doesn't exist yet.
 */
export interface PendingTag {
  tag_text: string;
  tag_id?: string;           // Only present for existing tags
  background_color?: string | null;
  text_color?: string | null;
  isNew: boolean;            // True if user typed a new tag that doesn't exist yet
}
