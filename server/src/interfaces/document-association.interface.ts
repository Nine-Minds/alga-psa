import { TenantEntity } from ".";

export interface IDocumentAssociation extends TenantEntity {
    association_id: string;
    document_id: string;
    entity_id: string;
    entity_type: 'ticket' | 'company' | 'contact' | 'schedule' | 'asset';
    entered_at?: Date;
    updated_at?: Date;
    notes?: string;
    created_by?: string;
}

export interface IDocumentAssociationInput {
    document_id: string;
    entity_id: string;
    entity_type: 'ticket' | 'company' | 'contact' | 'schedule' | 'asset';
    tenant: string;
    notes?: string;
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
