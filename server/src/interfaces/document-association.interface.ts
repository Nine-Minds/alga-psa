import { TenantEntity } from ".";

export type DocumentAssociationEntityType = 'user' | 'ticket' | 'client' | 'contact' | 'asset' | 'project_task' | 'contract' | 'tenant';

export interface IDocumentAssociation extends TenantEntity {
    association_id: string;
    document_id: string;
    entity_id: string;
    entity_type: DocumentAssociationEntityType;
    created_at?: Date;
    notes?: string;
    created_by?: string;
    is_entity_logo?: boolean;
}

export interface IDocumentAssociationInput {
    document_id: string;
    entity_id: string;
    entity_type: DocumentAssociationEntityType;
    tenant: string;
    notes?: string;
    is_entity_logo?: boolean;
}

// Asset-specific document associations
export interface IAssetDocumentAssociation extends TenantEntity {
    association_id: string;
    asset_id: string;
    document_id: string;
    notes?: string;
    created_at: Date;
    created_by: string;
}

export interface IAssetDocumentAssociationInput {
    asset_id: string;
    document_id: string;
    notes?: string;
    tenant: string;
}
