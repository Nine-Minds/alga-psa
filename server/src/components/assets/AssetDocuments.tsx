'use client';

import React from 'react';
import Documents from 'server/src/components/documents/Documents';
import { useEffect, useState } from 'react';
import { IDocument } from 'server/src/interfaces/document.interface';
import { getDocumentsByEntity } from 'server/src/lib/actions/document-actions/documentActions';

interface AssetDocumentsProps {
    assetId: string;
    tenant: string;
    initialDocuments?: IDocument[];
}

const AssetDocuments: React.FC<AssetDocumentsProps> = ({ assetId, tenant, initialDocuments }) => {
    const [documents, setDocuments] = useState<IDocument[]>(initialDocuments || []);
    const [isLoading, setIsLoading] = useState(!initialDocuments);

    const loadDocuments = async () => {
        try {
            const response = await getDocumentsByEntity(assetId, 'asset');
            // Handle both array and paginated response formats
            const documentsList = Array.isArray(response)
                ? response
                : response.documents || [];
            setDocuments(documentsList);
        } catch (error) {
            console.error('Error loading documents:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (initialDocuments && initialDocuments.length > 0) {
            setDocuments(initialDocuments);
            setIsLoading(false);
            return;
        }
        loadDocuments();
    }, [assetId, initialDocuments]);

    return (
        <Documents
            id='documents'
            documents={documents}
            gridColumns={3}
            userId={tenant} // Using tenant as userId since we're in tenant context
            entityId={assetId}
            entityType="asset"
            isLoading={isLoading}
            onDocumentCreated={loadDocuments}
        />
    );
};

export default AssetDocuments;
