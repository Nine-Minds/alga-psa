'use client';

import React from 'react';
import Documents from 'server/src/components/documents/Documents';
import { useEffect, useState } from 'react';
import { IDocument } from 'server/src/interfaces/document.interface';
import { getDocumentsByEntity } from '@product/actions/document-actions/documentActions';

interface AssetDocumentsProps {
    assetId: string;
    tenant: string;
}

const AssetDocuments: React.FC<AssetDocumentsProps> = ({ assetId, tenant }) => {
    const [documents, setDocuments] = useState<IDocument[]>([]);
    const [isLoading, setIsLoading] = useState(true);

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
        loadDocuments();
    }, [assetId]);

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
