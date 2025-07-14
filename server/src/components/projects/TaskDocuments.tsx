'use client'

import React, { useEffect, useState } from 'react';
import { Upload, Download, Trash2, File, FileText, Image, Paperclip } from 'lucide-react';
import { toast } from 'react-hot-toast';
import DocumentUpload from '../documents/DocumentUpload';
import { IDocument } from '@/interfaces/document.interface';
import { 
  getDocumentsByEntity,
  createDocumentAssociations,
  removeDocumentAssociations
} from '@/lib/actions/document-actions/documentActions';
import { downloadDocumentInBrowser } from '@/lib/actions/document-download/downloadHelpers';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ConfirmationDialog } from '../ui/ConfirmationDialog';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';

interface TaskDocumentsProps {
  taskId: string;
  editable?: boolean;
}

export default function TaskDocuments({ taskId, editable = true }: TaskDocumentsProps) {
  const [documents, setDocuments] = useState<IDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<IDocument | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    const fetchUser = async () => {
      const user = await getCurrentUser();
      setCurrentUser(user);
    };
    fetchUser();
  }, []);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const response = await getDocumentsByEntity(taskId, 'project_task');
      setDocuments(response.documents);
    } catch (error) {
      console.error('Error fetching documents:', error);
      toast.error('Failed to load documents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [taskId]);

  const handleDocumentUpload = async (result: { success: boolean; document: IDocument }) => {
    if (!result.success) {
      toast.error('Failed to upload document');
      return;
    }

    try {
      // Create association for the uploaded document
      await createDocumentAssociations(taskId, 'project_task', [result.document.document_id]);
      
      toast.success('Document uploaded successfully');
      
      // Refresh the document list
      await fetchDocuments();
      setShowUpload(false);
    } catch (error) {
      console.error('Error associating document:', error);
      toast.error('Failed to associate document with task');
    }
  };

  const handleDownload = async (document: IDocument) => {
    try {
      const result = await downloadDocumentInBrowser(document.document_id, document.document_name);
      if (!result.success) {
        throw new Error(result.error || 'Download failed');
      }
    } catch (error) {
      console.error('Error downloading document:', error);
      toast.error('Failed to download document');
    }
  };

  const handleDeleteClick = (document: IDocument) => {
    setDocumentToDelete(document);
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!documentToDelete) return;

    try {
      await removeDocumentAssociations(taskId, 'project_task', [documentToDelete.document_id]);
      toast.success('Document removed successfully');
      await fetchDocuments();
    } catch (error) {
      console.error('Error removing document:', error);
      toast.error('Failed to remove document');
    } finally {
      setShowDeleteConfirm(false);
      setDocumentToDelete(null);
    }
  };

  const getFileIcon = (mimeType?: string) => {
    if (!mimeType) return <File className="w-5 h-5" />;
    if (mimeType.includes('pdf')) return <FileText className="w-5 h-5 text-red-600" />;
    if (mimeType.includes('image')) return <Image className="w-5 h-5 text-blue-600" />;
    if (mimeType.includes('text') || mimeType.includes('document')) return <FileText className="w-5 h-5 text-blue-600" />;
    return <File className="w-5 h-5" />;
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return 'Unknown size';
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4" onClick={(e) => e.stopPropagation()}>
      {editable && (
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Paperclip className="w-5 h-5" />
            Attachments
          </h3>
          <Button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowUpload(!showUpload);
            }}
            size="sm"
            variant="outline"
            type="button"
          >
            <Upload className="w-4 h-4 mr-2" />
            Upload Files
          </Button>
        </div>
      )}

      {showUpload && currentUser && (
        <Card className="p-4" onClick={(e) => e.stopPropagation()}>
          <DocumentUpload
            id="task-document-upload"
            userId={currentUser.user_id}
            onUploadComplete={handleDocumentUpload}
            onCancel={() => setShowUpload(false)}
          />
        </Card>
      )}

      {documents.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No documents attached to this task
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => (
            <Card key={doc.document_id} className="p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {getFileIcon(doc.mime_type)}
                  <div>
                    <p className="font-medium text-sm">{doc.document_name}</p>
                    <p className="text-xs text-gray-500">
                      {formatFileSize(doc.file_size)}
                      {doc.type_name && ` • ${doc.type_name}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDownload(doc);
                    }}
                    size="sm"
                    variant="ghost"
                    type="button"
                    title="Download"
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                  {editable && (
                    <Button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleDeleteClick(doc);
                      }}
                      size="sm"
                      variant="ghost"
                      type="button"
                      className="text-red-600 hover:text-red-700"
                      title="Remove"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ConfirmationDialog
        isOpen={showDeleteConfirm}
        onClose={() => {
          setShowDeleteConfirm(false);
          setDocumentToDelete(null);
        }}
        onConfirm={handleDeleteConfirm}
        title="Remove Document"
        message="Are you sure you want to remove this document from the task?"
        confirmLabel="Remove"
        cancelLabel="Cancel"
      />
    </div>
  );
}