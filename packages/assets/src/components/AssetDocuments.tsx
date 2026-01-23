'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Documents from '@alga-psa/documents/components/Documents';
import type { IDocument } from '@alga-psa/types';

interface AssetDocumentsProps {
    assetId: string;
    tenant: string;
    initialDocuments?: IDocument[];
    onDocumentCreated?: () => Promise<void>;
}

const AssetDocuments: React.FC<AssetDocumentsProps> = ({
    assetId,
    tenant,
    initialDocuments = [],
    onDocumentCreated
}) => {
    const router = useRouter();
    const [documents, setDocuments] = useState<IDocument[]>(initialDocuments);
    const [isLoading, setIsLoading] = useState(false);

    // Sync from props when they change
    useEffect(() => {
        setDocuments(initialDocuments);
    }, [initialDocuments]);

    const handleDocumentCreated = useCallback(async () => {
        if (onDocumentCreated) {
            await onDocumentCreated();
        } else {
            router.refresh();
        }
    }, [onDocumentCreated, router]);

    return (
        <Documents
            id='documents'
            documents={documents}
            gridColumns={3}
            userId={tenant} // Using tenant as userId since we're in tenant context
            entityId={assetId}
            entityType="asset"
            isLoading={isLoading}
            onDocumentCreated={handleDocumentCreated}
        />
    );
};

export default AssetDocuments;
