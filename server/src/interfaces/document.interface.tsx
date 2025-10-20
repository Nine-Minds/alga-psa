import { TenantEntity } from ".";

export interface IDocument extends TenantEntity {
    document_id: string;
    document_name: string;
    type_id: string | null;
    shared_type_id?: string;
    user_id: string;
    contact_name_id?: string;
    client_id?: string;
    ticket_id?: string;
    schedule_id?: string;
    asset_id?: string;
    order_number: number;
    created_by: string;
    edited_by?: string;
    entered_at?: Date;
    updated_at?: Date;

    // Storage-related fields
    file_id?: string;
    storage_path?: string;
    mime_type?: string;
    file_size?: number;

    // Folder organization
    folder_path?: string;

    // Preview/thumbnail system
    thumbnail_file_id?: string;
    preview_file_id?: string;
    preview_generated_at?: Date;

    // Additional fields (not in the database)
    created_by_full_name?: string;
    type_name?: string;
    type_icon?: string;
}

export interface IDocumentType extends TenantEntity {
    type_id: string;
    type_name: string;
    icon?: string;
    isShared: boolean;
}

export interface ISharedDocumentType {
    type_id: string;
    type_name: string;
    icon?: string;
    description?: string;
    created_at?: Date;
    updated_at?: Date;
    isShared: boolean;
}

// Document storage configuration
export interface IDocumentStorageConfig {
    allowed_mime_types: string[];
    max_file_size: number;
}

// Document upload response
export interface IDocumentUploadResponse {
    file_id: string;
    storage_path: string;
    mime_type: string;
    file_size: number;
    original_name: string;
}

// Document filters for searching/filtering documents
export interface DocumentFilters {
    type?: string;
    entityType?: string;
    uploadedBy?: string;
    searchTerm?: string;
    excludeEntityId?: string;
    excludeEntityType?: string;
    updated_at_start?: string;
    updated_at_end?: string;
    folder_path?: string;
    sortBy?: 'document_name' | 'updated_at' | 'file_size' | 'created_by_full_name';
    sortOrder?: 'asc' | 'desc';
}

// Document preview response
export interface PreviewResponse {
    success: boolean;
    content?: string;
    previewImage?: string;
    error?: string;
    pageCount?: number;
}

// Document content stored in separate table
export interface IDocumentContent extends TenantEntity {
    id: string;
    document_id: string;
    content: string;
    created_by_id: string;
    updated_by_id: string;
    created_at: Date;
    updated_at: Date;
}

export type DocumentInput = Omit<IDocument, 'document_id'>;
export type DocumentContentInput = Omit<IDocumentContent, 'id'>;

// Input type for updating document content
export interface UpdateDocumentContentInput {
    content: string;
    updated_by_id: string;
}
export interface PaginatedDocumentsResponse {
  documents: IDocument[];
  totalCount: number;
  currentPage: number;
  totalPages: number;
}

// Folder-related interfaces
export interface IFolderNode {
  path: string;
  name: string;
  children: IFolderNode[];
  documentCount: number;
}

export interface IFolderStats {
  path: string;
  documentCount: number;
  totalSize: number;
}
