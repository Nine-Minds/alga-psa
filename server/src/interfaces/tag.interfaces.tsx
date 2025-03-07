import { TenantEntity } from ".";

export type TaggedEntityType = 'contact' | 'company' | 'ticket' | 'project' | 'workflow_form';

export interface ITag extends TenantEntity {
  tag_id: string;
  channel_id?: string;
  tag_text: string;
  tagged_id: string;
  tagged_type: TaggedEntityType;
}

export interface ITaggable {
  tags?: ITag[];
}