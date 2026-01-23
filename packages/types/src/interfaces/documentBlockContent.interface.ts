import { TenantEntity } from ".";
import { IDocument } from "./document.interface";

// Database table representation
export interface IDocumentBlockContent extends TenantEntity {
    content_id: string;
    document_id: string;
    block_data: any; // JSON data from BlockNote editor
    version_id?: string; // Optional reference to document_versions
    created_at?: Date;
    updated_at?: Date;
}

export interface IDocumentVersion extends TenantEntity {
    version_id: string;
    document_id: string;
    version_number: number;
    is_active: boolean;
    created_by?: string;
    created_at?: Date;
}

export type DocumentBlockContentInput = Omit<IDocumentBlockContent, 'content_id' | 'created_at' | 'updated_at'>;
export type DocumentVersionInput = Omit<IDocumentVersion, 'version_id' | 'created_at'>;

// Rich interfaces for accessing documents with relationships
export interface DocumentWithBlockContent {
    document: IDocument;
    blockContent?: IDocumentBlockContent;
}

export interface DocumentWithVersions extends DocumentWithBlockContent {
    versions?: IDocumentVersion[];
}

// Input types for creating/updating documents with block content
export interface DocumentWithBlockContentInput {
    document: Omit<IDocument, 'document_id'>;
    blockContent?: Omit<IDocumentBlockContent, 'content_id' | 'document_id' | 'created_at' | 'updated_at'>;
}
