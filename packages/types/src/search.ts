import type { Knex } from 'knex';

export const SEARCH_OBJECT_TYPES = [
  'client',
  'contact',
  'user',
  'ticket',
  'ticket_comment',
  'project',
  'project_phase',
  'project_task',
  'project_task_comment',
  'asset',
  'invoice',
  'invoice_item',
  'invoice_annotation',
  'contract',
  'client_contract',
  'document',
  'kb_article',
  'service_catalog',
  'service_request_submission',
  'service_request_definition',
  'workflow_task',
  'interaction',
  'schedule_entry',
  'time_entry',
  'board',
  'category',
  'tag',
  'status',
] as const;

export type SearchObjectType = (typeof SEARCH_OBJECT_TYPES)[number];

export interface AclMetadata {
  visibleToUserIds?: string[];
  visibleToRoles?: string[];
  isInternalOnly?: boolean;
  isPrivate?: boolean;
  clientScopeId?: string;
  requiredPermission?: string;
}

export interface SearchDoc {
  tenant: string;
  objectType: SearchObjectType;
  objectId: string;
  parentType?: SearchObjectType;
  parentId?: string;
  title: string;
  subtitle?: string;
  body?: string;
  url: string;
  metadata?: Record<string, unknown>;
  acl: AclMetadata;
  sourceUpdatedAt: Date;
}

export interface EntityIndexer {
  objectType: SearchObjectType;
  sourceEvents: readonly string[];
  loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null>;
  loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]>;
}
