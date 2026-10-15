'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Paperclip } from 'lucide-react';
import type { IDocument } from '@alga-psa/types';
import { useDocumentsCrossFeature } from '@alga-psa/core/context/DocumentsCrossFeatureContext';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { ContentCardVariantProvider } from '@alga-psa/ui/components';
import {
  BentoMicroBadge,
  BentoRow,
  BentoRowList,
  BentoRowMeta,
  BentoTile,
  BentoTileAddButton,
  BentoTileEmpty,
  BentoTileEmptyAction,
} from '@alga-psa/ui/components/bento';

const MAX_ROWS = 5;

/** "PDF" / "DOC" style extension badge: file extension first, mime subtype as fallback. */
function documentExtension(doc: IDocument): string {
  const name = doc.document_name || '';
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) {
    const ext = name.slice(dot + 1).trim();
    if (ext.length > 0 && ext.length <= 5) return ext.toUpperCase();
  }
  const subtype = (doc.mime_type || '').split('/')[1] || '';
  if (subtype) return subtype.replace(/^x-/, '').slice(0, 4).toUpperCase();
  return 'DOC';
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * The paperwork a deal collects — RFPs, scoping notes, signed letters of
 * intent — filed against the opportunity itself rather than the quote it may
 * one day produce.
 *
 * The fetch runs in the browser so the tile behaves the same on the full page
 * and inside the shared drawer, where nothing above it re-renders on the
 * server.
 */
export function OpportunityDocumentsTile({
  id = 'opportunity-detail-documents-tile',
  opportunityId,
}: {
  id?: string;
  opportunityId: string;
}) {
  const { t } = useTranslation('msp/opportunities');
  const { data: session } = useSession();
  const { getDocumentsByEntity, renderDocuments } = useDocumentsCrossFeature();
  const [documents, setDocuments] = useState<IDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewingDocument, setViewingDocument] = useState<IDocument | null>(null);
  const [isManagerOpen, setIsManagerOpen] = useState(false);

  const loadDocuments = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getDocumentsByEntity(opportunityId, 'opportunity');
      // Permission and action errors come back as a result object, not a throw.
      setDocuments(Array.isArray(result?.documents) ? result.documents : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [getDocumentsByEntity, opportunityId]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const visible = documents.slice(0, MAX_ROWS);
  const overflow = documents.length - visible.length;

  return (
    <>
      <BentoTile
        id={id}
        title={t('opportunities.detail.documents', 'Documents')}
        icon={<Paperclip className="h-4 w-4" aria-hidden="true" />}
        error={error}
        action={
          <BentoTileAddButton
            id={`${id}-manage`}
            label={t('opportunities.detail.manageDocuments', 'Add or manage documents')}
            onClick={() => setIsManagerOpen(true)}
          />
        }
      >
        {isLoading ? (
          <BentoTileEmpty id={`${id}-loading`}>
            {t('opportunities.detail.documentsLoading', 'Loading documents…')}
          </BentoTileEmpty>
        ) : documents.length === 0 ? (
          <>
            <BentoTileEmpty id={`${id}-empty`}>
              {t('opportunities.detail.noDocuments', 'No documents yet. Attach the RFP, scoping notes or signed paperwork here.')}
            </BentoTileEmpty>
            <BentoTileEmptyAction id={`${id}-add`} onClick={() => setIsManagerOpen(true)}>
              {t('opportunities.detail.addDocument', 'Attach a document')}
            </BentoTileEmptyAction>
          </>
        ) : (
          <div>
            <BentoRowList>
              {visible.map((doc) => {
                const size = formatFileSize(doc.file_size);
                return (
                  <BentoRow id={`${id}-row-${doc.document_id}`} key={doc.document_id} stacked>
                    <button
                      type="button"
                      onClick={() => setViewingDocument(doc)}
                      className="group flex w-full min-w-0 items-center gap-2 text-left text-sm"
                      title={doc.document_name}
                    >
                      <BentoMicroBadge>{documentExtension(doc)}</BentoMicroBadge>
                      <span className="min-w-0 truncate text-[rgb(var(--color-text-700))] group-hover:text-[rgb(var(--color-primary-600))] group-hover:underline">
                        {doc.document_name}
                      </span>
                      {size ? <BentoRowMeta>{size}</BentoRowMeta> : null}
                    </button>
                  </BentoRow>
                );
              })}
            </BentoRowList>
            {overflow > 0 ? (
              <button
                id={`${id}-view-all`}
                type="button"
                onClick={() => setIsManagerOpen(true)}
                className="mt-2 text-xs font-medium text-[rgb(var(--color-primary-600))] hover:underline"
              >
                {t('opportunities.detail.viewAllDocuments', 'View all {{count}}', { count: documents.length })}
              </button>
            ) : null}
          </div>
        )}
      </BentoTile>

      {viewingDocument
        ? renderDocuments({
            id: `${id}-view-drawer`,
            documents,
            userId: session?.user?.id || '',
            entityId: opportunityId,
            entityType: 'opportunity',
            documentToOpen: viewingDocument,
            drawerOnly: true,
            onDocumentClosed: () => setViewingDocument(null),
            onDocumentCreated: loadDocuments,
          })
        : null}

      <Dialog
        id={`${id}-manager-dialog`}
        isOpen={isManagerOpen}
        onClose={() => setIsManagerOpen(false)}
        title={t('opportunities.detail.documents', 'Documents')}
        className="max-w-3xl"
      >
        {/* Reset the bento variant: inside the dialog the documents manager has
            room and should render in its standard shape. */}
        <ContentCardVariantProvider variant="default">
          {renderDocuments({
            id: `${id}-manager`,
            documents,
            userId: session?.user?.id || '',
            entityId: opportunityId,
            entityType: 'opportunity',
            isLoading,
            onDocumentCreated: loadDocuments,
          })}
        </ContentCardVariantProvider>
      </Dialog>
    </>
  );
}

export default OpportunityDocumentsTile;
