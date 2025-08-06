import { TenantEntity } from ".";
import { TagDefinition } from '@alga-psa/shared/interfaces/tag.interfaces';

// Server-specific TaggedEntityType includes additional types not in shared
export type TaggedEntityType = 'contact' | 'company' | 'ticket' | 'project' | 'project_task' | 'workflow_form' | 'document' | 'knowledge_base_article';

// ITag combines TagDefinition fields with additional server requirements
export interface ITag extends TenantEntity {
  tag_id: string;
  channel_id?: string;
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