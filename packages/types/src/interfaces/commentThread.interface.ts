import { TenantEntity } from './index';

export interface ICommentThread extends TenantEntity {
  thread_id: string;
  ticket_id: string | null;
  project_task_id: string | null;
  root_comment_id: string;
  is_internal: boolean;
  reply_count: number;
  last_activity_at: string;
  email_message_id: string | null;
  email_references: string[];
  email_provider_thread_id: string | null;
  created_at: string;
  created_by: string | null;
}
