'use client';

import React, { useState } from 'react';
import { FileText, Plus, Eye } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IDocument } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { ContentCardVariantProvider } from '@alga-psa/ui/components';
import { BentoTile, BentoTileEmpty } from '@alga-psa/ui/components/bento/BentoTile';
import TicketDocumentsSection from './../TicketDocumentsSection';

const MAX_ROWS = 5;

interface DocumentsTileProps {
  id: string;
  ticketId: string;
  documents: IDocument[];
  onDocumentCreated: () => Promise<void>;
  /** Prefer this resolver when provided (e.g. client portal); falls back to the standard document URLs. */
  resolveDocumentViewUrl?: (document: { document_id?: string; file_id?: string }) => string;
  forceUploadToRoot?: boolean;
  allowDocumentSharing?: boolean;
  allowLinkExistingDocuments?: boolean;
  allowBlockDocuments?: boolean;
}

/** "PDF" / "DOC" style extension badge text: file extension first, mime subtype as fallback. */
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

/** Mirrors the app's own attachment URL fallback (view by file, download by document). */
function documentViewUrl(
  doc: IDocument,
  resolve?: (document: { document_id?: string; file_id?: string }) => string,
): string {
  if (resolve) return resolve({ document_id: doc.document_id, file_id: doc.file_id });
  return doc.file_id
    ? `/api/documents/view/${doc.file_id}`
    : `/api/documents/download/${doc.document_id}`;
}

function DocumentRow({
  id,
  doc,
  resolveDocumentViewUrl,
  t,
}: {
  id: string;
  doc: IDocument;
  resolveDocumentViewUrl?: DocumentsTileProps['resolveDocumentViewUrl'];
  t: (key: string, defaultValue: string) => string;
}) {
  const size = formatFileSize(doc.file_size);
  return (
    <li id={id} className="py-1.5 first:pt-0 last:pb-0">
      <a
        href={documentViewUrl(doc, resolveDocumentViewUrl)}
        target="_blank"
        rel="noreferrer"
        className="group flex items-center gap-2 min-w-0 text-sm"
        title={doc.document_name}
      >
        <span className="flex-shrink-0 rounded border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] px-1 py-0.5 text-[9px] font-semibold tracking-wide text-[rgb(var(--color-text-500))]">
          {documentExtension(doc)}
        </span>
        <span className="min-w-0 truncate text-[rgb(var(--color-text-700))] group-hover:text-[rgb(var(--color-primary-600))] group-hover:underline">
          {doc.document_name}
        </span>
        {doc.is_client_visible ? (
          <Eye
            className="h-3 w-3 flex-shrink-0 text-[rgb(var(--color-text-400))]"
            aria-label={t('bento.tiles.clientVisible', 'Client visible')}
          />
        ) : null}
        {size ? (
          <span className="ml-auto flex-shrink-0 text-xs text-[rgb(var(--color-text-400))]">{size}</span>
        ) : null}
      </a>
    </li>
  );
}

/**
 * Compact "Documents" tile for the ticket Grid layout: one row per document
 * (extension badge · name · size), a "+" that opens the full documents
 * manager in a dialog, and a "View all" overflow for long lists. The full
 * TicketDocumentsSection keeps every management flow (new / upload / link /
 * share / delete) — it just lives in a dialog instead of the narrow rail.
 */
export function DocumentsTile({
  id,
  ticketId,
  documents,
  onDocumentCreated,
  resolveDocumentViewUrl,
  forceUploadToRoot,
  allowDocumentSharing,
  allowLinkExistingDocuments,
  allowBlockDocuments,
}: DocumentsTileProps) {
  const { t } = useTranslation('features/tickets');
  const [isManagerOpen, setIsManagerOpen] = useState(false);
  const visible = documents.slice(0, MAX_ROWS);
  const overflow = documents.length - visible.length;

  return (
    <>
      <BentoTile
        id={id}
        title={t('bento.tiles.documents', 'Documents')}
        icon={<FileText className="h-4 w-4" />}
        action={
          <Button
            id={`${id}-manage-btn`}
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            aria-label={t('bento.tiles.addOrManageDocuments', 'Add or manage documents')}
            onClick={() => setIsManagerOpen(true)}
          >
            <Plus className="h-4 w-4" />
          </Button>
        }
      >
        {documents.length === 0 ? (
          <div>
            <BentoTileEmpty id={`${id}-empty`}>{t('bento.tiles.noDocuments', 'No documents yet')}</BentoTileEmpty>
            <button
              id={`${id}-add-link`}
              type="button"
              onClick={() => setIsManagerOpen(true)}
              className="inline-flex items-center gap-1 text-xs font-medium text-[rgb(var(--color-primary-600))] hover:underline mt-1"
            >
              <Plus className="h-3 w-3" /> {t('bento.tiles.addDocument', 'Add a document')}
            </button>
          </div>
        ) : (
          <div>
            <ul className="divide-y divide-[rgb(var(--color-border-100))]">
              {visible.map((doc) => (
                <DocumentRow
                  key={doc.document_id}
                  id={`${id}-row-${doc.document_id}`}
                  doc={doc}
                  resolveDocumentViewUrl={resolveDocumentViewUrl}
                  t={t}
                />
              ))}
            </ul>
            {overflow > 0 ? (
              <button
                id={`${id}-view-all`}
                type="button"
                onClick={() => setIsManagerOpen(true)}
                className="text-xs font-medium text-[rgb(var(--color-primary-600))] hover:underline mt-2"
              >
                {t('bento.tiles.viewAllCount', 'View all {{count}}', { count: documents.length })}
              </button>
            ) : null}
          </div>
        )}
      </BentoTile>

      <Dialog
        id={`${id}-manager-dialog`}
        isOpen={isManagerOpen}
        onClose={() => setIsManagerOpen(false)}
        className="max-w-3xl"
      >
        {/* Reset the bento card variant: inside the dialog the full documents
            manager has room and should render in its standard shape. */}
        <ContentCardVariantProvider variant="default">
          <TicketDocumentsSection
            id={`${id}-manager-section`}
            ticketId={ticketId}
            initialDocuments={documents}
            onDocumentCreated={onDocumentCreated}
            forceUploadToRoot={forceUploadToRoot}
            allowDocumentSharing={allowDocumentSharing}
            allowLinkExistingDocuments={allowLinkExistingDocuments}
            allowBlockDocuments={allowBlockDocuments}
          />
        </ContentCardVariantProvider>
      </Dialog>
    </>
  );
}

export default DocumentsTile;
