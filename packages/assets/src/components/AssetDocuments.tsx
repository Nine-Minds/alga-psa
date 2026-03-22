'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDocumentsCrossFeature } from '@alga-psa/core/context/DocumentsCrossFeatureContext';
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
    const { renderDocuments } = useDocumentsCrossFeature();
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
        <>
            {renderDocuments({
                id: 'documents',
                documents,
                gridColumns: 3,
                userId: tenant,
                entityId: assetId,
                entityType: 'asset',
                isLoading,
                onDocumentCreated: handleDocumentCreated,
            })}
        </>
    );
};

export default AssetDocuments;
