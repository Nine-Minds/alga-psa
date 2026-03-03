'use client';

import React from 'react';
import type { IDocument } from '@alga-psa/types';
import { formatBytes, formatDate } from '@alga-psa/core/formatters';
import { FileIcon, Download, Trash2, Share2, Link2 } from 'lucide-react';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import VisibilityToggle from './VisibilityToggle';

interface DocumentListViewProps {
  documents: IDocument[];
  selectedDocuments: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
  onDelete?: (document: IDocument) => void;
  onClick?: (document: IDocument) => void;
  showVisibilityControls?: boolean;
  onToggleVisibility?: (document: IDocument, nextValue: boolean) => void | Promise<void>;
  visibilityUpdatingIds?: Set<string>;
  showShareControls?: boolean;
  onShare?: (document: IDocument) => void;
  documentsWithShareLinks?: Set<string>;
}

export default function DocumentListView({
  documents,
  selectedDocuments,
  onSelectionChange,
  onDelete,
  onClick,
  showVisibilityControls = false,
  onToggleVisibility,
  visibilityUpdatingIds,
  showShareControls = false,
  onShare,
  documentsWithShareLinks
}: DocumentListViewProps) {
  const { t } = useTranslation('common');

  function toggleSelection(documentId: string) {
    const newSelected = new Set(selectedDocuments);
    if (newSelected.has(documentId)) {
      newSelected.delete(documentId);
    } else {
      newSelected.add(documentId);
    }
    onSelectionChange(newSelected);
  }

  function toggleSelectAll() {
    if (selectedDocuments.size === documents.length) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(documents.map(d => d.document_id)));
    }
  }

  return (
    <div className="border border-gray-200 dark:border-[rgb(var(--color-border-200))] rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">
              <Checkbox
                id="document-select-all"
                checked={selectedDocuments.size === documents.length && documents.length > 0}
                onChange={toggleSelectAll}
              />
            </TableHead>
            <TableHead>
              {t('documents.list.name', 'Name')}
            </TableHead>
            <TableHead>
              {t('documents.list.folder', 'Folder')}
            </TableHead>
            <TableHead>
              {t('documents.list.size', 'Size')}
            </TableHead>
            <TableHead>
              {t('documents.list.modified', 'Modified')}
            </TableHead>
            {showVisibilityControls && (
              <TableHead>
                {t('documents.list.visibility', 'Visibility')}
              </TableHead>
            )}
            <TableHead className="w-24">
              {t('documents.list.actions', 'Actions')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((doc) => (
            <TableRow
              key={doc.document_id}
              className="cursor-pointer"
              onClick={() => onClick?.(doc)}
            >
              <TableCell onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  id={`document-checkbox-${doc.document_id}`}
                  checked={selectedDocuments.has(doc.document_id)}
                  onChange={() => toggleSelection(doc.document_id)}
                />
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  {doc.thumbnail_file_id ? (
                    <img
                      src={`/api/documents/${doc.document_id}/thumbnail`}
                      alt={doc.document_name}
                      className="w-8 h-8 object-cover rounded border border-gray-200 dark:border-[rgb(var(--color-border-200))]"
                      onError={(e) => {
                        // Fallback to icon if thumbnail fails to load
                        e.currentTarget.style.display = 'none';
                        e.currentTarget.nextElementSibling?.classList.remove('hidden');
                      }}
                    />
                  ) : null}
                  <FileIcon className={`w-4 h-4 text-gray-400 ${doc.thumbnail_file_id ? 'hidden' : ''}`} />
                  <span className="text-sm font-medium">{doc.document_name}</span>
                  {documentsWithShareLinks?.has(doc.document_id) && (
                    <span title={t('documents.hasShareLinks', 'Has active share links')}>
                      <Link2 className="w-3 h-3 text-blue-500" />
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {doc.folder_path || '/'}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {doc.file_size ? formatBytes(doc.file_size) : '-'}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {doc.updated_at ? formatDate(doc.updated_at) : '-'}
              </TableCell>
              {showVisibilityControls && (
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        doc.is_client_visible
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                          : 'bg-gray-100 text-gray-700 dark:bg-[rgb(var(--color-border-100))] dark:text-[rgb(var(--color-text-400))]'
                      }`}
                    >
                      {doc.is_client_visible
                        ? t('documents.visibility.clientVisible', 'Client visible')
                        : t('documents.visibility.internalOnly', 'Internal')}
                    </span>
                    {onToggleVisibility && (
                      <VisibilityToggle
                        id={`document-visibility-${doc.document_id}`}
                        isClientVisible={Boolean(doc.is_client_visible)}
                        onToggle={(nextValue) => {
                          void onToggleVisibility(doc, nextValue);
                        }}
                        disabled={visibilityUpdatingIds?.has(doc.document_id)}
                      />
                    )}
                  </div>
                </TableCell>
              )}
              <TableCell onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-1">
                  <button
                    id={`document-download-${doc.document_id}`}
                    className="p-1 hover:bg-gray-100 rounded transition-colors"
                    title={t('documents.download', 'Download')}
                  >
                    <Download className="w-4 h-4 text-gray-500" />
                  </button>
                  {showShareControls && onShare && (
                    <button
                      id={`document-share-${doc.document_id}`}
                      className="p-1 hover:bg-blue-100 rounded transition-colors"
                      onClick={() => onShare(doc)}
                      title={t('documents.share', 'Share')}
                    >
                      <Share2 className="w-4 h-4 text-blue-500" />
                    </button>
                  )}
                  {onDelete && (
                    <button
                      id={`document-delete-${doc.document_id}`}
                      className="p-1 hover:bg-red-100 rounded transition-colors"
                      onClick={() => onDelete(doc)}
                      title={t('documents.delete', 'Delete')}
                    >
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
          {documents.length === 0 && (
            <TableRow>
              <TableCell colSpan={showVisibilityControls ? 7 : 6} className="h-24 text-center text-muted-foreground">
                {t('documents.empty.default', 'No documents found')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
