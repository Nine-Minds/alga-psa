import { TenantEntity } from '.';

export interface IProjectTaskComment extends TenantEntity {
  taskCommentId: string;
  taskId: string;  // REQUIRED - always present
  threadId?: string;
  parentCommentId?: string | null;
  userId: string | null;
  authorType: 'internal' | 'client';

  note: string;  // BlockNote JSON
  markdownContent: string;  // Generated from BlockNote

  createdAt: string;
  updatedAt?: string;
  editedAt?: string;
  deletedAt?: string | null;
}

export interface IProjectTaskCommentWithUser extends IProjectTaskComment {
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl?: string | null;
  organizationName?: string;
  audience?: 'requester' | 'shared_it' | 'organization_private';
  collaborationRevision?: number;
  canEdit?: boolean;
  canReply?: boolean;
  canReact?: boolean;
}
