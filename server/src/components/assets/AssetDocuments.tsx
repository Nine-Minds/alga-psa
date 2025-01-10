'use client';

import React from 'react';
import Documents from '@/components/documents/Documents';
import { useEffect, useState } from 'react';
import { IDocument } from '@/interfaces/document.interface';
import { getDocumentsByEntity } from '@/lib/actions/document-actions/documentActions';

interface AssetDocumentsProps {
    assetId: string;
    tenant: string;
}

const AssetDocuments: React.FC<AssetDocumentsProps> = ({ assetId, tenant }) => {
    const [documents, setDocuments] = useState<IDocument[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const loadDocuments = async () => {
        try {
            const docs = await getDocumentsByEntity(assetId, 'asset');
            setDocuments(docs);
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
