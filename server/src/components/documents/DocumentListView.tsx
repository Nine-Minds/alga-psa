'use client';

import React from 'react';
import { IDocument } from '@/interfaces/document.interface';
import { formatBytes, formatDate } from '@/lib/utils/formatters';
import { FileIcon, Download, Trash2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/Checkbox';
import { useTranslation } from 'server/src/lib/i18n/client';

interface DocumentListViewProps {
  documents: IDocument[];
  selectedDocuments: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
  onDelete?: (document: IDocument) => void;
  onClick?: (document: IDocument) => void;
}

export default function DocumentListView({
  documents,
  selectedDocuments,
  onSelectionChange,
  onDelete,
  onClick
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
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <table className="w-full">
        <thead className="bg-gray-50 dark:bg-gray-800">
          <tr>
            <th className="w-12 px-4 py-3">
              <Checkbox
                id="document-select-all"
                checked={selectedDocuments.size === documents.length && documents.length > 0}
                onChange={toggleSelectAll}
              />
            </th>
            <th className="text-left px-4 py-3 text-sm font-medium">
              {t('documents.list.name', 'Name')}
            </th>
            <th className="text-left px-4 py-3 text-sm font-medium">
              {t('documents.list.folder', 'Folder')}
            </th>
            <th className="text-left px-4 py-3 text-sm font-medium">
              {t('documents.list.size', 'Size')}
            </th>
            <th className="text-left px-4 py-3 text-sm font-medium">
              {t('documents.list.modified', 'Modified')}
            </th>
            <th className="w-24 px-4 py-3 text-sm font-medium">
              {t('documents.list.actions', 'Actions')}
            </th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <tr
              key={doc.document_id}
              className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
              onClick={() => onClick?.(doc)}
            >
              <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  id={`document-checkbox-${doc.document_id}`}
                  checked={selectedDocuments.has(doc.document_id)}
                  onChange={() => toggleSelection(doc.document_id)}
                />
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  {doc.thumbnail_file_id ? (
                    <img
                      src={`/api/documents/${doc.document_id}/thumbnail`}
                      alt={doc.document_name}
                      className="w-8 h-8 object-cover rounded border border-gray-200 dark:border-gray-600"
                      onError={(e) => {
                        // Fallback to icon if thumbnail fails to load
                        e.currentTarget.style.display = 'none';
                        e.currentTarget.nextElementSibling?.classList.remove('hidden');
                      }}
                    />
                  ) : null}
                  <FileIcon className={`w-4 h-4 text-gray-400 ${doc.thumbnail_file_id ? 'hidden' : ''}`} />
                  <span className="text-sm">{doc.document_name}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-gray-500">
                {doc.folder_path || '/'}
              </td>
              <td className="px-4 py-3 text-sm text-gray-500">
                {doc.file_size ? formatBytes(doc.file_size) : '-'}
              </td>
              <td className="px-4 py-3 text-sm text-gray-500">
                {doc.updated_at ? formatDate(doc.updated_at) : '-'}
              </td>
              <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-1">
                  <button
                    id={`document-download-${doc.document_id}`}
                    className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                    title={t('documents.download', 'Download')}
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  {onDelete && (
                    <button
                      id={`document-delete-${doc.document_id}`}
                      className="p-1 hover:bg-red-100 dark:hover:bg-red-900/20 rounded"
                      onClick={() => onDelete(doc)}
                      title={t('documents.delete', 'Delete')}
                    >
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {documents.length === 0 && (
        <div className="p-8 text-center text-gray-500">
          {t('documents.empty.default', 'No documents found')}
        </div>
      )}
    </div>
  );
}
