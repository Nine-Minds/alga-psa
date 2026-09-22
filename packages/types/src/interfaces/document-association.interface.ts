import { TenantEntity } from ".";

export type DocumentAssociationEntityType = 'user' | 'ticket' | 'client' | 'contact' | 'asset' | 'project_task' | 'contract' | 'tenant' | 'quote' | 'invoice' | 'sales_order' | 'document';

/** Logo slot for entity logos: light/dark mark, landscape wordmark, or favicon. */
export type EntityLogoVariant = 'default' | 'dark' | 'wide' | 'wide-dark' | 'favicon';

/**
 * The square zone of a logo shown in avatar-sized slots, as fractions of the
 * source image (0..1). Fractions survive EXIF rotation, SVG rasterization and
 * browser downscaling, which pixel offsets would not.
 */
export interface LogoCropRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface IDocumentAssociation extends TenantEntity {
    association_id: string;
    document_id: string;
    entity_id: string;
    entity_type: DocumentAssociationEntityType;
    created_at?: Date;
    notes?: string;
    created_by?: string;
    is_entity_logo?: boolean;
    entity_logo_variant?: EntityLogoVariant;
}

export interface IDocumentAssociationInput {
    document_id: string;
    entity_id: string;
    entity_type: DocumentAssociationEntityType;
    tenant: string;
    notes?: string;
    is_entity_logo?: boolean;
    entity_logo_variant?: EntityLogoVariant;
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
