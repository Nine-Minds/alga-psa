'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'server/src/lib/i18n/client';
import {
  uploadClientTaskDocument,
  getClientTaskDocuments
} from 'server/src/lib/actions/client-portal-actions/client-project-details';
import { format } from 'date-fns';
import { getDateFnsLocale } from 'server/src/lib/utils/dateFnsLocale';
import { Button } from 'server/src/components/ui/Button';

interface Document {
  document_id: string;
  document_name: string;
  mime_type: string;
  file_size: number;
  created_by: string;
  entered_at: Date;
  uploaded_by_name: string;
}

interface TaskDocumentUploadProps {
  taskId: string;
}

export default function TaskDocumentUpload({ taskId }: TaskDocumentUploadProps) {
  const { t, i18n } = useTranslation('clientPortal');
  const dateLocale = getDateFnsLocale(i18n.language);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDocuments = async () => {
    try {
      const result = await getClientTaskDocuments(taskId);
      if (result.success && result.documents) {
        setDocuments(result.documents);
      } else if (!result.success) {
        setError(result.error || 'Failed to load documents');
      }
    } catch (err) {
      console.error('Error fetching documents:', err);
      setError('Failed to load documents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [taskId]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const result = await uploadClientTaskDocument(taskId, formData);

      if (result.success) {
        // Refresh documents list
        await fetchDocuments();
        // Reset file input
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      } else {
        setError(result.error || t('projects.documents.uploadError', 'Failed to upload document'));
      }
    } catch (err) {
      console.error('Error uploading document:', err);
      setError(t('projects.documents.uploadError', 'Failed to upload document'));
    } finally {
      setUploading(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h5 className="text-sm font-medium text-gray-700">
          {t('projects.documents.title', 'Documents')}
        </h5>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileSelect}
            className="hidden"
            id={`file-upload-${taskId}`}
            disabled={uploading}
          />
          <Button
            id="upload-document-button"
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading
              ? t('common.upload', 'Uploading...')
              : t('projects.documents.upload', 'Upload Document')}
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-2">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="animate-pulse space-y-2">
          <div className="h-8 bg-gray-200 rounded"></div>
        </div>
      ) : documents.length === 0 ? (
        <p className="text-xs text-gray-500 italic">
          {t('projects.documents.noDocuments', 'No documents attached')}
        </p>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => (
            <div
              key={doc.document_id}
              className="flex items-center justify-between p-2 bg-gray-50 rounded border border-gray-200"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <svg
                    className="w-4 h-4 text-gray-400 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {doc.document_name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatFileSize(doc.file_size)} • {doc.uploaded_by_name} •{' '}
                      {format(new Date(doc.entered_at), 'PPP', { locale: dateLocale })}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
