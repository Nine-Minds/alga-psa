import type { IComment, PortalTicketExternalLink } from '@alga-psa/types';

/** Explicit ticket fields that are part of the client portal contract. */
export interface ClientTicketIdentity { name: string; role: 'staff' | 'client' | 'contact' | 'system'; avatar_url?: string | null }
export interface ClientTicketDocument {
  document_id: string;
  document_name: string;
  type_id: string | null;
  client_id?: string;
  ticket_id?: string;
  order_number: number;
  entered_at?: Date | string;
  updated_at?: Date | string;
  file_id?: string;
  mime_type?: string;
  file_size?: number;
  folder_path?: string;
  is_client_visible?: boolean;
  comment_attachment_is_public?: boolean;
  type_name?: string;
  type_icon?: string;
  created_by_full_name?: string;
}
export interface ClientTicketListResponse {
  ticket_id: string;
  ticket_number: string;
  title: string;
  url?: string | null;
  board_id: string | null;
  client_id: string | null;
  contact_name_id: string | null;
  status_id?: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  entered_at?: string | null;
  updated_at?: string | null;
  closed_at?: string | null;
  due_date?: string | null;
  response_state?: string | null;
  priority_id?: string | null;
  assigned_to_name?: string | null;
  assigned_to_avatar_url?: string | null;
  assigned_team_id?: string | null;
  tenant?: string;
  status_name?: string | null;
  priority_name?: string | null;
  priority_color?: string | null;
  board_name?: string | null;
  category_name?: string | null;
  assigned_team_name?: string | null;
  additional_agent_count?: number;
  additional_agents?: ClientTicketIdentity[];
}

export interface ClientTicketDetailResponse extends ClientTicketListResponse {
  attributes: { description?: unknown } | null;
  ticket_origin?: string;
  has_original_email?: boolean;
  can_interact?: boolean;
  conversations?: Array<Omit<IComment, 'user_id' | 'contact_id' | 'actor_reference_id'> & { portal_author?: { name: string; role: 'staff' | 'client' | 'contact' | 'service' | 'collaborator' | 'system'; avatarUrl?: string | null } | null; portal_can_edit?: boolean; bundle_mirror_source?: { source_comment_id: string } | null }>;
  documents?: ClientTicketDocument[];
  linkedAssets?: Array<{ asset_id: string; name: string; asset_tag: string | null; asset_type: string | null; relationship_type: string | null }>;
  portalExternalLinks?: PortalTicketExternalLink[];
}

export function projectClientTicketList(row: Record<string, any>): ClientTicketListResponse {
  return {
    ticket_id: row.ticket_id,
    ticket_number: row.ticket_number,
    title: row.title,
    url: row.url ?? null,
    board_id: row.board_id ?? null,
    client_id: row.client_id ?? null,
    contact_name_id: row.contact_name_id ?? null,
    status_id: row.status_id ?? null,
    category_id: row.category_id ?? null,
    subcategory_id: row.subcategory_id ?? null,
    entered_at: row.entered_at instanceof Date ? row.entered_at.toISOString() : row.entered_at ?? null,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at ?? null,
    closed_at: row.closed_at instanceof Date ? row.closed_at.toISOString() : row.closed_at ?? null,
    due_date: row.due_date ?? null,
    response_state: row.response_state ?? null,
    priority_id: row.priority_id ?? null,
    status_name: row.status_name ?? null,
    priority_name: row.priority_name ?? null,
    priority_color: row.priority_color ?? null,
    board_name: row.board_name ?? null,
    category_name: row.category_name ?? null,
    assigned_to_name: row.assigned_to_name ?? null,
    assigned_team_name: row.assigned_team_name ?? null,
    additional_agent_count: row.additional_agent_count ?? 0,
    assigned_to_avatar_url: row.assigned_to_avatar_url ?? null,
    assigned_team_id: row.assigned_team_id ?? null,
    tenant: row.tenant,
    additional_agents: (row.additional_agents ?? []).map((person: any) => ({ name: person.name, role: 'staff' as const, avatar_url: person.avatar_url ?? null })),
  };
}

export function projectClientTicketDetail(row: Record<string, any>): ClientTicketDetailResponse {
  return {
    ...projectClientTicketList(row),
    board_id: row.board_id ?? null,
    client_id: row.client_id ?? null,
    contact_name_id: row.contact_name_id ?? null,
    attributes: row.attributes && typeof row.attributes === 'object' ? { description: row.attributes.description } : null,
    ticket_origin: row.ticket_origin,
    has_original_email: Boolean(row.has_original_email),
    can_interact: row.can_interact,
  };
}

export function projectClientTicketDocument(row: Record<string, any>): ClientTicketDocument {
  return {
    document_id: row.document_id,
    document_name: row.document_name,
    type_id: row.type_id ?? null,
    ...(row.client_id ? { client_id: row.client_id } : {}),
    ...(row.ticket_id ? { ticket_id: row.ticket_id } : {}),
    order_number: row.order_number,
    ...(row.entered_at ? { entered_at: row.entered_at } : {}),
    ...(row.updated_at ? { updated_at: row.updated_at } : {}),
    ...(row.file_id ? { file_id: row.file_id } : {}),
    ...(row.mime_type ? { mime_type: row.mime_type } : {}),
    ...(row.file_size != null ? { file_size: row.file_size } : {}),
    ...(row.folder_path ? { folder_path: row.folder_path } : {}),
    ...(row.is_client_visible != null ? { is_client_visible: row.is_client_visible } : {}),
    ...(row.comment_attachment_is_public != null ? { comment_attachment_is_public: row.comment_attachment_is_public } : {}),
    ...(row.type_name ? { type_name: row.type_name } : {}),
    ...(row.type_icon ? { type_icon: row.type_icon } : {}),
    ...(row.created_by_full_name ? { created_by_full_name: row.created_by_full_name } : {}),
  };
}
