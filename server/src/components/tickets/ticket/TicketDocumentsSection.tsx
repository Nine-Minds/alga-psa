'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Documents from 'server/src/components/documents/Documents';
import { useTranslation } from 'server/src/lib/i18n/client';
import { IDocument } from 'server/src/interfaces/document.interface';
import { getDocumentByTicketId } from 'server/src/lib/actions/document-actions/documentActions';
import styles from './TicketDetails.module.css';
import { withDataAutomationId } from 'server/src/types/ui-reflection/withDataAutomationId';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';

interface TicketDocumentsSectionProps {
  id?: string;
  ticketId: string;
  initialDocuments?: IDocument[];
  onDocumentCreated?: () => Promise<void>;
}

const TicketDocumentsSection: React.FC<TicketDocumentsSectionProps> = ({
  id = 'ticket-documents-section',
  ticketId,
  initialDocuments = [],
  onDocumentCreated
}) => {
  const router = useRouter();
  const { t } = useTranslation('clientPortal');
  const { data: session } = useSession();
  const userId = session?.user?.id || '';

  const [documents, setDocuments] = useState<IDocument[]>(initialDocuments);
  const [isLoading, setIsLoading] = useState(false);

  // Sync documents from props when they change
  useEffect(() => {
    setDocuments(initialDocuments);
  }, [initialDocuments]);

  // Fallback fetch function (only used if initialDocuments not provided)
  const fetchDocuments = async () => {
    if (!ticketId) return;

    setIsLoading(true);
    try {
      const docs = await getDocumentByTicketId(ticketId);
      setDocuments(docs || []);
    } catch (error) {
      console.error('Error fetching documents:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Only fetch if we don't have initialDocuments
  useEffect(() => {
    if (initialDocuments.length === 0 && ticketId) {
      fetchDocuments();
    }
  }, [ticketId]);

  // Handle document creation - use callback or router.refresh()
  const handleDocumentCreated = useCallback(async () => {
    if (onDocumentCreated) {
      await onDocumentCreated();
    } else {
      router.refresh();
    }
  }, [onDocumentCreated, router]);

  // Create a ref for the upload form container
  const uploadFormRef = useRef<HTMLDivElement>(null);

  return (
    <ReflectionContainer id={id} label="Ticket Documents">
      <div {...withDataAutomationId({ id })} className={`${styles['card']}`}>
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">{t('tickets.documents.title', 'Documents')}</h2>
          </div>
          <Documents
            id={`${id}-documents`}
            documents={documents}
            userId={userId}
            entityId={ticketId}
            entityType="ticket"
            isLoading={isLoading}
            onDocumentCreated={handleDocumentCreated}
            uploadFormRef={uploadFormRef}
            namespace="clientPortal"
          />
        </div>
      </div>
    </ReflectionContainer>
  );
};

export default TicketDocumentsSection;
