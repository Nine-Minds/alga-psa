import { TenantEntity } from ".";

export interface IDocument extends TenantEntity {
    document_id: string;
    document_name: string;
    type_id: string | null;  // Updated to allow null for shared document types
    shared_type_id?: string;  // New field for shared document types
    user_id: string;
    contact_name_id?: string;
    company_id?: string;
    ticket_id?: string;
    schedule_id?: string;
    asset_id?: string;  // Added for asset document associations
    order_number: number;
    created_by: string;
    edited_by?: string;
    entered_at?: Date;
    updated_at?: Date;

    // Storage-related fields
    file_id?: string;  // Reference to external_files table
    storage_path?: string;  // Path within the storage provider
    mime_type?: string;  // MIME type of the stored file
    file_size?: number;  // Size of the file in bytes

    // Additional fields (not in the database)
    created_by_full_name?: string;
    type_name?: string;  // Document type name from document_types or shared_document_types
    type_icon?: string;  // Document type icon from document_types or shared_document_types
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
    excludeEntityId?: string;  // Added to exclude documents associated with a specific entity
    excludeEntityType?: string;  // Added to specify the entity type to exclude
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
