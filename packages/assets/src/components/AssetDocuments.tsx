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
    /** Optional loading state supplied by the parent while it fetches `initialDocuments`. */
    isLoading?: boolean;
}

// Module-level so omitting `initialDocuments` yields a referentially stable value;
// a fresh `[]` default would re-trigger the prop-sync effect on every render.
const EMPTY_DOCUMENTS: IDocument[] = [];

const AssetDocuments: React.FC<AssetDocumentsProps> = ({
    assetId,
    tenant,
    initialDocuments = EMPTY_DOCUMENTS,
    onDocumentCreated,
    isLoading = false
}) => {
    const router = useRouter();
    const { renderDocuments } = useDocumentsCrossFeature();
    const [documents, setDocuments] = useState<IDocument[]>(initialDocuments);

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
