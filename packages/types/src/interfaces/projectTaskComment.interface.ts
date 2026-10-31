import { TenantEntity } from '.';

export interface IProjectTaskComment extends TenantEntity {
  taskCommentId: string;
  taskId: string;  // REQUIRED - always present
  threadId?: string;
  parentCommentId?: string | null;
  /** Null for a comment authored by a foreign collaborator or a portal contact. */
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
  /** Qualified author label for collaborator- and contact-authored rows (L4c). */
  organizationName?: string;
  /** A missing kind means 'user' (rows written before contact authorship existed). */
  authorKind?: 'user' | 'contact';
  actorReferenceId?: string | null;
  contactId?: string | null;
  audience?: 'requester' | 'shared_it' | 'organization_private';
  collaborationRevision?: number;
  canEdit?: boolean;
  canReply?: boolean;
  canReact?: boolean;
}
