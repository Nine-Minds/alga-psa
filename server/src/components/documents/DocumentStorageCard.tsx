'use client';

import { useState, useEffect } from 'react';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { IDocument } from 'server/src/interfaces/document.interface';
import { getDocumentPreview } from 'server/src/lib/actions/document-actions/documentActions';
import { getDocumentDownloadUrl } from 'server/src/lib/utils/documentUtils';
import { Button } from 'server/src/components/ui/Button';
import {
    Download,
    Trash2,
    FileText,
    Image,
    File,
    Loader2,
    FileSpreadsheet,
    FileType,
    FileCode,
    Unlink,
    EyeOff
} from 'lucide-react';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { ContainerComponent, ButtonComponent } from 'server/src/types/ui-reflection/types';

export interface DocumentStorageCardProps {
    id: string;
    document: IDocument;
    onDelete?: (document: IDocument) => void;
    onDisassociate?: (document: IDocument) => void;
    hideActions?: boolean;
    showDisassociate?: boolean;
    onClick?: () => void;
    isContentDocument?: boolean;
}

export default function DocumentStorageCard({
    id,
    document,
    onDelete,
    onDisassociate,
    hideActions = false,
    showDisassociate = false,
    onClick,
    isContentDocument = false
}: DocumentStorageCardProps): JSX.Element {
    const [previewContent, setPreviewContent] = useState<{
        content?: string;
        previewImage?: string;
        error?: string;
    }>({});
    const [isLoading, setIsLoading] = useState(false);
    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
    const [showDisassociateConfirmation, setShowDisassociateConfirmation] = useState(false);

    // Debug log
    console.log('Rendering DocumentStorageCard with document:', document);

    const loadPreview = async () => {
        if (!document.file_id) return;

        try {
            setIsLoading(true);
            const preview = await getDocumentPreview(document.file_id);
            setPreviewContent(preview);
        } catch (error) {
            console.error('Error getting preview:', error);
            setPreviewContent({ error: 'Failed to load preview' });
        } finally {
            setIsLoading(false);
        }
    };

    // Load preview on mount
    useEffect(() => {
        loadPreview();
    }, [document.file_id]);

    const handleDelete = async () => {
        if (!onDelete) return;
        setShowDeleteConfirmation(true);
    };

    const confirmDelete = async () => {
        if (!onDelete) return;
        
        try {
            setIsLoading(true);
            await onDelete(document);
        } catch (error) {
            console.error('Error deleting document:', error);
        } finally {
            setIsLoading(false);
            setShowDeleteConfirmation(false);
        }
    };

    const handleDisassociate = async () => {
        if (!onDisassociate) return;
        setShowDisassociateConfirmation(true);
    };

    const confirmDisassociate = async () => {
        if (!onDisassociate) return;
        
        try {
            setIsLoading(true);
            await onDisassociate(document);
        } catch (error) {
            console.error('Error disassociating document:', error);
        } finally {
            setIsLoading(false);
            setShowDisassociateConfirmation(false);
        }
    };

    const handleView = () => {
        if (!document.file_id) return;
        const downloadUrl = getDocumentDownloadUrl(document.file_id);
        window.open(downloadUrl, '_blank');
    };

    const getFileIcon = () => {
        if (!document.mime_type) return <File className="w-6 h-6" />;

        if (document.mime_type.startsWith('image/')) {
            return <Image className="w-6 h-6" />;
        }
        if (document.mime_type === 'application/pdf') {
            return <FileType className="w-6 h-6" />;
        }
        if (document.mime_type.includes('spreadsheet') || document.mime_type.includes('excel')) {
            return <FileSpreadsheet className="w-6 h-6" />;
        }
        if (document.mime_type.includes('javascript') || document.mime_type.includes('typescript') || document.mime_type.includes('json')) {
            return <FileCode className="w-6 h-6" />;
        }
        return <FileText className="w-6 h-6" />;
    };

    return (<>
        <ReflectionContainer id={id} label={`Document Card - ${document.document_name}`}>
            <div className={`bg-white rounded-lg border border-[rgb(var(--color-border-200))] shadow-sm p-4 h-full flex flex-col transition-all hover:border-[rgb(var(--color-border-300))] ${isContentDocument ? 'cursor-pointer' : ''
                }`}
                onClick={isContentDocument && onClick ? (e) => {
                    // Prevent click event if it's coming from the delete button
                    if (e.target instanceof Element &&
                        (e.target.closest('button[id^="delete-document"]') ||
                            e.target.closest('button[id^="disassociate-document"]'))) {
                        return;
                    }
                    onClick();
                } : undefined}
                role={isContentDocument ? "button" : undefined}
                tabIndex={isContentDocument ? 0 : undefined}
            >
                <div className="flex-1">
                    <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0 mr-2">
                            <div className="flex items-center space-x-2">
                                {getFileIcon()}
                                <h3 className="text-sm font-medium text-[rgb(var(--color-text-900))] truncate">
                                    {document.document_name}
                                </h3>
                            </div>
                            <p className="mt-1 text-xs text-[rgb(var(--color-text-500))] truncate">
                                {document.created_by_full_name || (document.created_by ? `User ${document.created_by.substring(0, 8)}...` : "Unknown User")}
                                {document.entered_at && (
                                    <span className="ml-1">
                                        • {new Date(document.entered_at).toLocaleDateString()}
                                    </span>
                                )}
                                {!document.entered_at && document.updated_at && (
                                    <span className="ml-1">
                                        • {new Date(document.updated_at).toLocaleDateString()}
                                    </span>
                                )}
                            </p>
                            {document.type_name && (
                                <p className="mt-1 text-xs text-[rgb(var(--color-text-500))] truncate">
                                    Type: {document.type_name}
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="space-y-1">
                        {document.mime_type && (
                            <p className="text-xs text-[rgb(var(--color-text-500))]">
                                {document.mime_type}
                            </p>
                        )}

                        {document.file_size && (
                            <p className="text-xs text-[rgb(var(--color-text-500))]">
                                Size: {(document.file_size / 1024).toFixed(1)} KB
                            </p>
                        )}
                    </div>

                    {/* Preview Content */}
                    {isLoading ? (
                        <div className="mt-4 flex justify-center">
                            <Loader2 className="animate-spin h-8 w-8 text-[rgb(var(--color-primary-400))]" />
                        </div>
                    ) : previewContent.error ? (
                        <div className="mt-4 flex items-center space-x-2 text-[rgb(var(--color-text-500))]">
                            <EyeOff className="w-4 h-4" />
                            <p className="text-sm">Preview unavailable</p>
                        </div>
                    ) : (
                        <div className="mt-4 preview-container">
                            {previewContent.previewImage ? (
                                <img
                                    src={previewContent.previewImage}
                                    alt={document.document_name}
                                    className="max-w-full h-auto rounded-md border border-[rgb(var(--color-border-200))] cursor-pointer"
                                    style={{ maxHeight: '200px', objectFit: 'contain' }}
                                    onClick={handleView}
                                    role="button"
                                    tabIndex={0}
                                />
                            ) : previewContent.content ? (
                                <div
                                    className="text-sm text-[rgb(var(--color-text-700))] max-h-[200px] overflow-hidden p-3 rounded-md bg-[rgb(var(--color-border-50))] border border-[rgb(var(--color-border-200))] cursor-pointer"
                                    style={{
                                        display: '-webkit-box',
                                        WebkitLineClamp: '8',
                                        WebkitBoxOrient: 'vertical'
                                    }}
                                    dangerouslySetInnerHTML={{ __html: previewContent.content }}
                                    onClick={handleView}
                                    role="button"
                                    tabIndex={0}
                                />
                            ) : null}
                        </div>
                    )}
                </div>

                {!hideActions && (
                    <div className="mt-4 pt-3 flex flex-col space-y-1.5 items-end border-t border-[rgb(var(--color-border-100))]">
                        <Button
                            id={`download-document-${document.document_id}-button`}
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                                e.stopPropagation();
                                const isPdfTarget = document.type_name === 'text/plain' ||
                                                    document.type_name === 'text/markdown' ||
                                                    (!document.type_name && !document.file_id);
                                
                                let downloadUrl = '#';
                                if (isPdfTarget) {
                                    downloadUrl = `/api/documents/download/${document.document_id}?format=pdf`;
                                } else if (document.document_id) {
                                    downloadUrl = `/api/documents/download/${document.document_id}`;
                                }
                                
                                if (downloadUrl !== '#') {
                                    window.open(downloadUrl, '_blank');
                                }
                            }}
                            disabled={isLoading}
                            className="text-[rgb(var(--color-text-600))] hover:text-[rgb(var(--color-text-900))] hover:bg-[rgb(var(--color-border-100))] inline-flex items-center"
                        >
                            <Download className="w-4 h-4 mr-2" />
                            Download
                        </Button>
                        {showDisassociate && onDisassociate && (
                            <Button
                                id={`disassociate-document-${document.document_id}-button`}
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                    e.stopPropagation(); // Prevent event bubbling to parent
                                    handleDisassociate();
                                }}
                                disabled={isLoading}
                                className="text-[rgb(var(--color-text-600))] hover:text-orange-600 hover:bg-orange-50 inline-flex items-center"
                            >
                                <Unlink className="w-4 h-4 mr-2" />
                                {isLoading ? 'Removing...' : 'Remove'}
                            </Button>
                        )}
                        {onDelete && (
                            <Button
                                id={`delete-document-${document.document_id}-button`}
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                    e.stopPropagation(); // Prevent event bubbling to parent
                                    handleDelete();
                                }}
                                disabled={isLoading}
                                className="text-[rgb(var(--color-text-600))] hover:text-red-600 hover:bg-red-50 inline-flex items-center"
                            >
                                <Trash2 className="w-4 h-4 mr-2" />
                                {isLoading ? 'Deleting...' : 'Delete'}
                            </Button>
                        )}
                    </div>
                )}
            </div>
        </ReflectionContainer>
        {/* Delete Confirmation Dialog */}
        <ConfirmationDialog
            id={`${id}-delete-confirmation`}
            isOpen={showDeleteConfirmation}
            onClose={() => setShowDeleteConfirmation(false)}
            onConfirm={confirmDelete}
            title="Delete Document"
            message={`Are you sure you want to delete "${document.document_name}"? This action cannot be undone.`}
            confirmLabel="Delete"
            cancelLabel="Cancel"
            isConfirming={isLoading}
        />

        {/* Disassociate Confirmation Dialog */}
        {
            onDisassociate && (
                <ConfirmationDialog
                    id={`${id}-disassociate-confirmation`}
                    isOpen={showDisassociateConfirmation}
                    onClose={() => setShowDisassociateConfirmation(false)}
                    onConfirm={confirmDisassociate}
                    title="Remove Document"
                    message={`Are you sure you want to remove "${document.document_name}" from this item? The document will still be available in the document library.`}
                    confirmLabel="Remove"
                    cancelLabel="Cancel"
                    isConfirming={isLoading}
                />
            )
        }
        </>
    );

}
