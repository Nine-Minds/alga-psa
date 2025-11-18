import { TenantEntity } from '.';

export interface IProjectTaskComment extends TenantEntity {
  taskCommentId: string;
  taskId: string;  // REQUIRED - always present
  userId: string;
  authorType: 'internal';  // Always 'internal'

  note: string;  // BlockNote JSON
  markdownContent: string;  // Generated from BlockNote

  createdAt: string;
  updatedAt?: string;
  editedAt?: string;
}

export interface IProjectTaskCommentWithUser extends IProjectTaskComment {
  firstName: string;
  lastName: string;
  email: string;
}
