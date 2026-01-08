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
import { downloadDocument, getDocumentDownloadUrl } from 'server/src/lib/utils/documentUtils';
import {
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileSpreadsheet,
  FileArchive,
  File,
  Download,
  Upload,
  Paperclip,
  ChevronDown,
  ChevronUp,
  Eye,
  X
} from 'lucide-react';
import Spinner from 'server/src/components/ui/Spinner';
import FolderSelectorModal from 'server/src/components/documents/FolderSelectorModal';

interface Document {
  document_id: string;
  document_name: string;
  mime_type: string;
  file_size: number;
  file_id: string;
  created_by: string;
  entered_at: Date;
  uploaded_by_name: string;
}

interface TaskDocumentUploadProps {
  taskId: string;
  compact?: boolean;
}

// Check if file type can be previewed
function isViewableType(mimeType: string): boolean {
  return (
    mimeType?.startsWith('image/') ||
    mimeType?.startsWith('video/') ||
    mimeType === 'application/pdf'
  );
}

// Get appropriate icon based on mime type
function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return FileImage;
  if (mimeType.startsWith('video/')) return FileVideo;
  if (mimeType.startsWith('audio/')) return FileAudio;
  if (mimeType.includes('pdf')) return FileText;
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) return FileSpreadsheet;
  if (mimeType.includes('zip') || mimeType.includes('archive') || mimeType.includes('compressed')) return FileArchive;
  if (mimeType.includes('document') || mimeType.includes('text')) return FileText;
  return File;
}

// Get file extension from name or mime type
function getFileExtension(fileName: string, mimeType: string): string {
  const ext = fileName.split('.').pop()?.toUpperCase();
  if (ext && ext.length <= 5) return ext;
  // Fallback based on mime type
  if (mimeType.includes('pdf')) return 'PDF';
  if (mimeType.includes('png')) return 'PNG';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'JPG';
  if (mimeType.includes('gif')) return 'GIF';
  if (mimeType.includes('word')) return 'DOC';
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return 'XLS';
  return 'FILE';
}

export default function TaskDocumentUpload({ taskId, compact = false }: TaskDocumentUploadProps) {
  const { t, i18n } = useTranslation('clientPortal');
  const dateLocale = getDateFnsLocale(i18n.language);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Preview modal state
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewDocument, setPreviewDocument] = useState<Document | null>(null);

  // Folder selection state
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

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

    // Show folder selector modal
    setPendingFile(file);
    setShowFolderModal(true);

    // Reset file input so the same file can be selected again if needed
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFolderSelected = async (folderPath: string | null) => {
    if (!pendingFile) return;

    setShowFolderModal(false);
    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', pendingFile);

      const result = await uploadClientTaskDocument(taskId, formData, folderPath);

      if (result.success) {
        // Refresh documents list
        await fetchDocuments();
      } else {
        setError(result.error || t('projects.documents.uploadError', 'Failed to upload document'));
      }
    } catch (err) {
      console.error('Error uploading document:', err);
      setError(t('projects.documents.uploadError', 'Failed to upload document'));
    } finally {
      setUploading(false);
      setPendingFile(null);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Handle document click - view if viewable, download otherwise
  const handleDocumentClick = async (doc: Document) => {
    if (!doc.file_id) return;

    // For viewable types, open preview modal
    if (isViewableType(doc.mime_type)) {
      setPreviewDocument(doc);
      setShowPreviewModal(true);
      return;
    }

    // For other files, trigger download using the existing utility
    const downloadUrl = getDocumentDownloadUrl(doc.file_id);
    try {
      await downloadDocument(downloadUrl, doc.document_name, true);
    } catch (err) {
      console.error('Download failed:', err);
      setError(t('projects.documents.downloadError', 'Failed to download document'));
    }
  };

  // Handle explicit download button click
  const handleDownload = async (doc: Document, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!doc.file_id) return;

    const downloadUrl = getDocumentDownloadUrl(doc.file_id);
    try {
      await downloadDocument(downloadUrl, doc.document_name, true);
    } catch (err) {
      console.error('Download failed:', err);
      setError(t('projects.documents.downloadError', 'Failed to download document'));
    }
  };

  // Document card component for reuse
  const DocumentCard = ({ doc, showFullDetails = true }: { doc: Document; showFullDetails?: boolean }) => {
    const FileIcon = getFileIcon(doc.mime_type);
    const fileExt = getFileExtension(doc.document_name, doc.mime_type);
    const canView = isViewableType(doc.mime_type);
    const isImage = doc.mime_type?.startsWith('image/');

    return (
      <div
        className={`flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200 hover:border-gray-300 transition-colors ${canView ? 'cursor-pointer' : ''}`}
        onClick={() => canView && handleDocumentClick(doc)}
      >
        {/* Thumbnail for images, icon for others */}
        <div className="relative flex-shrink-0">
          {isImage && doc.file_id ? (
            <div className="w-10 h-10 bg-gray-100 rounded-lg overflow-hidden">
              <img
                src={`/api/documents/view/${doc.file_id}`}
                alt=""
                className="w-full h-full object-cover"
                onError={(e) => {
                  // On error, hide image and show icon
                  e.currentTarget.style.display = 'none';
                }}
              />
            </div>
          ) : (
            <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
              <FileIcon className="w-5 h-5 text-gray-500" />
            </div>
          )}
          <span className="absolute -bottom-1 -right-1 text-[9px] font-bold bg-purple-100 text-purple-700 px-1 rounded">
            {fileExt}
          </span>
        </div>

        {/* File details */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate" title={doc.document_name}>
            {doc.document_name}
          </p>
          {showFullDetails ? (
            <p className="text-xs text-gray-500">
              {formatFileSize(doc.file_size)} • {doc.uploaded_by_name} • {format(new Date(doc.entered_at), 'PP', { locale: dateLocale })}
            </p>
          ) : (
            <p className="text-xs text-gray-500">
              {formatFileSize(doc.file_size)}
            </p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* View button for viewable types */}
          {canView && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDocumentClick(doc);
              }}
              className="p-2 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
              title={t('projects.documents.view', 'View')}
            >
              <Eye className="w-4 h-4" />
            </button>
          )}

          {/* Download button */}
          <button
            type="button"
            onClick={(e) => handleDownload(doc, e)}
            className="p-2 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
            title={t('projects.documents.download', 'Download')}
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  };

  // Preview Modal
  const PreviewModal = () => {
    if (!showPreviewModal || !previewDocument || !previewDocument.file_id) return null;

    const viewUrl = `/api/documents/view/${previewDocument.file_id}`;

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75"
        onClick={() => setShowPreviewModal(false)}
      >
        <div
          className="relative max-w-7xl max-h-[90vh] w-full mx-4"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            className="absolute top-4 right-4 text-white hover:text-gray-300 z-10 bg-black bg-opacity-50 rounded-full p-2"
            onClick={() => setShowPreviewModal(false)}
          >
            <X className="w-6 h-6" />
          </button>

          {/* Download button in modal */}
          <button
            className="absolute top-4 right-16 text-white hover:text-gray-300 z-10 bg-black bg-opacity-50 rounded-full p-2"
            onClick={(e) => handleDownload(previewDocument, e)}
            title={t('projects.documents.download', 'Download')}
          >
            <Download className="w-6 h-6" />
          </button>

          {/* Content based on type */}
          {previewDocument.mime_type?.startsWith('image/') && (
            <img
              src={viewUrl}
              alt={previewDocument.document_name}
              className="max-w-full max-h-[90vh] object-contain mx-auto"
            />
          )}
          {previewDocument.mime_type?.startsWith('video/') && (
            <video
              src={viewUrl}
              controls
              className="max-w-full max-h-[90vh] mx-auto"
            />
          )}
          {previewDocument.mime_type === 'application/pdf' && (
            <iframe
              src={viewUrl}
              className="w-full h-[90vh] bg-white"
              title={previewDocument.document_name}
            />
          )}

          {/* Document name */}
          <div className="mt-2 text-center text-white">
            <p className="text-lg font-medium">{previewDocument.document_name}</p>
          </div>
        </div>
      </div>
    );
  };

  // Compact mode for kanban cards - shows upload button with doc count and expandable list
  if (compact) {
    return (
      <>
        <div className="space-y-2">
          {/* Header row with upload and toggle */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => documents.length > 0 && setExpanded(!expanded)}
              disabled={loading || documents.length === 0}
              className="text-gray-500 hover:text-gray-700 flex items-center gap-1 disabled:cursor-default disabled:hover:text-gray-500 p-1 rounded hover:bg-gray-100 transition-colors"
              title={loading ? '' : `${documents.length} ${documents.length === 1 ? t('projects.documents.file', 'file') : t('projects.documents.files', 'files')}`}
            >
              <Paperclip className="w-4 h-4" />
              {!loading && documents.length > 0 && (
                <span className="text-xs font-medium min-w-[1rem] text-center">{documents.length}</span>
              )}
              {!loading && documents.length > 0 && (
                expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
              )}
            </button>

            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileSelect}
              className="hidden"
              id={`file-upload-${taskId}`}
              disabled={uploading}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="text-purple-600 hover:text-purple-700 p-1 rounded hover:bg-purple-50 transition-colors"
              title={uploading ? t('common.uploading', 'Uploading...') : t('projects.documents.upload', 'Upload')}
            >
              {uploading ? (
                <Spinner size="xs" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* Error message */}
          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}

          {/* Expanded document list */}
          {expanded && documents.length > 0 && (
            <div className="space-y-1.5 pt-1">
              {documents.map((doc) => {
                const FileIcon = getFileIcon(doc.mime_type);
                const fileExt = getFileExtension(doc.document_name, doc.mime_type);
                const canView = isViewableType(doc.mime_type);
                const isImage = doc.mime_type?.startsWith('image/');

                return (
                  <div
                    key={doc.document_id}
                    className={`flex items-center gap-2 p-2 bg-white rounded border border-gray-200 hover:border-gray-300 transition-colors ${canView ? 'cursor-pointer' : ''}`}
                    onClick={() => canView && handleDocumentClick(doc)}
                  >
                    {/* Small thumbnail/icon */}
                    <div className="relative flex-shrink-0">
                      {isImage && doc.file_id ? (
                        <div className="w-8 h-8 bg-gray-100 rounded overflow-hidden">
                          <img
                            src={`/api/documents/view/${doc.file_id}`}
                            alt=""
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        </div>
                      ) : (
                        <div className="w-8 h-8 bg-gray-100 rounded flex items-center justify-center">
                          <FileIcon className="w-4 h-4 text-gray-500" />
                        </div>
                      )}
                      <span className="absolute -bottom-0.5 -right-0.5 text-[7px] font-bold bg-purple-100 text-purple-700 px-0.5 rounded">
                        {fileExt}
                      </span>
                    </div>

                    {/* File name - truncated */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-900 truncate" title={doc.document_name}>
                        {doc.document_name}
                      </p>
                      <p className="text-[10px] text-gray-500">
                        {formatFileSize(doc.file_size)}
                      </p>
                    </div>

                    {/* Download button only */}
                    <button
                      type="button"
                      onClick={(e) => handleDownload(doc, e)}
                      className="p-1 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors flex-shrink-0"
                      title={t('projects.documents.download', 'Download')}
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Preview Modal */}
        <PreviewModal />

        {/* Folder Selection Modal */}
        <FolderSelectorModal
          isOpen={showFolderModal}
          onClose={() => {
            setShowFolderModal(false);
            setPendingFile(null);
          }}
          onSelectFolder={handleFolderSelected}
          title={t('projects.documents.selectFolder', 'Select Destination Folder')}
          description={
            pendingFile
              ? t('projects.documents.selectFolderDescription', {
                  fileName: pendingFile.name,
                  defaultValue: `Where would you like to save "${pendingFile.name}"?`
                })
              : t('projects.documents.selectFolderDefault', 'Choose where to save this document')
          }
        />
      </>
    );
  }

  // Full mode for list view
  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h5 className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <Paperclip className="w-4 h-4" />
            {t('projects.documents.title', 'Attachments')}
            {!loading && documents.length > 0 && (
              <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                {documents.length}
              </span>
            )}
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
              {uploading ? (
                <>
                  <Spinner size="xs" className="mr-1" />
                  {t('common.uploading', 'Uploading...')}
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-1" />
                  {t('projects.documents.upload', 'Upload')}
                </>
              )}
            </Button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="animate-pulse space-y-2">
            <div className="h-16 bg-gray-100 rounded-lg"></div>
            <div className="h-16 bg-gray-100 rounded-lg"></div>
          </div>
        ) : documents.length === 0 ? (
          <div className="text-center py-6 bg-gray-50 rounded-lg border border-dashed border-gray-200">
            <Paperclip className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">
              {t('projects.documents.noDocuments', 'No documents attached')}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {t('projects.documents.uploadHint', 'Upload files to share with this task')}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => (
              <DocumentCard key={doc.document_id} doc={doc} showFullDetails={true} />
            ))}
          </div>
        )}
      </div>

      {/* Preview Modal */}
      <PreviewModal />

      {/* Folder Selection Modal */}
      <FolderSelectorModal
        isOpen={showFolderModal}
        onClose={() => {
          setShowFolderModal(false);
          setPendingFile(null);
        }}
        onSelectFolder={handleFolderSelected}
        title={t('projects.documents.selectFolder', 'Select Destination Folder')}
        description={
          pendingFile
            ? t('projects.documents.selectFolderDescription', {
                fileName: pendingFile.name,
                defaultValue: `Where would you like to save "${pendingFile.name}"?`
              })
            : t('projects.documents.selectFolderDefault', 'Choose where to save this document')
        }
      />
    </>
  );
}
