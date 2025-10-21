'use client';

import React, { useState, useEffect, useRef, memo } from 'react';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { IDocument } from 'server/src/interfaces/document.interface';
import Spinner from 'server/src/components/ui/Spinner';
import { getDocumentPreview } from 'server/src/lib/actions/document-actions/documentActions';
import { getDocumentDownloadUrl, downloadDocument } from 'server/src/lib/utils/documentUtils';
import { Button } from 'server/src/components/ui/Button';
import { useTranslation } from 'server/src/lib/i18n/client';
import {
    Download,
    Trash2,
    FileText,
    Image,
    File,
    FileSpreadsheet,
    FileType,
    FileCode,
    Unlink,
    EyeOff,
    Video,
    Eye,
    X,
    Play,
    FolderInput
} from 'lucide-react';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { ContainerComponent, ButtonComponent } from 'server/src/types/ui-reflection/types';

// Helper component for video previews with browser compatibility checking
interface VideoPreviewProps {
    fileId: string;
    mimeType: string;
    fileName: string;
    onClick: (e: React.MouseEvent) => void;
}

function VideoPreviewComponent({ fileId, mimeType, fileName, onClick }: VideoPreviewProps) {
    const { t } = useTranslation('clientPortal');
    const [canPlay, setCanPlay] = useState<boolean | null>(null);

    useEffect(() => {
        // Check if browser can play this video format
        const video = document.createElement('video');
        const canPlayResult = video.canPlayType(mimeType);
        setCanPlay(canPlayResult === 'probably' || canPlayResult === 'maybe');
    }, [mimeType]);

    // Browser-supported video formats (common ones)
    // QuickTime/MOV is supported on Safari and most modern browsers
    // AVI support varies by browser and codec
    const isBrowserSupported = mimeType === 'video/mp4' ||
                               mimeType === 'video/webm' ||
                               mimeType === 'video/ogg' ||
                               mimeType === 'video/quicktime' ||
                               mimeType === 'video/x-msvideo' ||
                               mimeType === 'video/avi';

    if (canPlay === false || !isBrowserSupported) {
        // Show fallback for unsupported formats
        return (
            <div 
                className="max-w-full h-48 rounded-md border border-[rgb(var(--color-border-200))] cursor-pointer transition-all hover:border-[rgb(var(--color-border-300))] bg-gray-50 flex flex-col items-center justify-center group"
                onClick={onClick}
            >
                <Video className="w-12 h-12 text-gray-400 mb-2" />
                <p className="text-sm text-gray-600 text-center px-4">
                    {fileName}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                    {mimeType}
                </p>
                <div className="mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="bg-black bg-opacity-50 text-white p-2 rounded-full">
                        <Play className="w-4 h-4" />
                    </div>
                </div>
            </div>
        );
    }

    // Show native video preview for supported formats
    return (
        <div className="relative group">
            <video
                className="max-w-full h-auto rounded-md border border-[rgb(var(--color-border-200))] cursor-pointer transition-opacity group-hover:opacity-75"
                style={{ maxHeight: '200px', objectFit: 'contain' }}
                onClick={onClick}
                controls={false}
                muted
                preload="metadata"
            >
                <source src={`/api/documents/view/${fileId}`} type={mimeType} />
                {t('documents.videoTagUnsupported', 'Your browser does not support the video tag.')}
            </video>
            <div 
                className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                onClick={onClick}
            >
                <div className="bg-black bg-opacity-50 text-white p-2 rounded-full pointer-events-none">
                    <Eye className="w-6 h-6" />
                </div>
            </div>
        </div>
    );
}

// Modal component for video playback with browser compatibility checking
interface VideoModalProps {
    fileId: string;
    documentId: string;
    mimeType: string;
    fileName: string;
}

function VideoModalComponent({ fileId, documentId, mimeType, fileName }: VideoModalProps) {
    const { t } = useTranslation('clientPortal');
    const [videoError, setVideoError] = useState(false);
    const videoRef = React.useRef<HTMLVideoElement>(null);

    // Handle source error - check if video element can play this format
    const handleSourceError = () => {
        if (videoRef.current) {
            const canPlayType = videoRef.current.canPlayType(mimeType);
            if (canPlayType === '') {
                setVideoError(true);
            } else {
                // Format is supported but source failed - might be a network issue
                // Give it a moment and then show error
                setTimeout(() => {
                    if (videoRef.current && videoRef.current.readyState === 0) {
                        setVideoError(true);
                    }
                }, 1000);
            }
        }
    };

    // Show video player by default - let the browser determine if it can play
    // Only show download fallback if video actually fails to load
    if (videoError) {
        return (
            <div className="text-center p-8">
                <Video className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <p className="text-[rgb(var(--color-text-700))] mb-2 font-medium">
                    {fileName}
                </p>
                <p className="text-[rgb(var(--color-text-500))] mb-4 text-sm">
                    {t('documents.videoPlaybackFailed', 'Unable to play this video in the browser')}
                </p>
                <p className="text-xs text-[rgb(var(--color-text-500))] mb-4">
                    Chrome may not support this video codec. Try downloading or use Safari/Edge.
                </p>
                <Button
                    id={`download-video-${fileId}`}
                    onClick={async () => {
                        const downloadUrl = getDocumentDownloadUrl(documentId);
                        const filename = fileName || 'download';
                        try {
                            await downloadDocument(downloadUrl, filename, true);
                        } catch (error) {
                            console.error('Download failed:', error);
                        }
                    }}
                    className="mb-2"
                >
                    <Download className="w-4 h-4 mr-2" />
                    {t('documents.downloadToPlay', 'Download to Play')}
                </Button>
                <div className="text-xs text-[rgb(var(--color-text-400))] mt-2">
                    {t('documents.videoDownloadInfo', "The video will be downloaded and can be played with your system's default video player")}
                </div>
            </div>
        );
    }

    // Try to play the video - the browser will handle compatibility
    return (
        <div>
            <video
                ref={videoRef}
                className="max-w-full max-h-[70vh] object-contain"
                controls
                autoPlay={false}
                preload="metadata"
                onError={() => setVideoError(true)}
            >
                <source
                    src={`/api/documents/view/${fileId}`}
                    type={mimeType}
                    onError={handleSourceError}
                />
                {t('documents.videoTagUnsupported', 'Your browser does not support the video tag.')}
            </video>
            <div className="text-center mt-4">
                <p className="text-sm text-gray-600 mb-2">
                    {t('documents.videoPlaybackIssue', 'Having trouble playing the video?')}
                </p>
                <Button
                    id={`download-video-fallback-${fileId}`}
                    onClick={async () => {
                        const downloadUrl = getDocumentDownloadUrl(documentId);
                        const filename = fileName || 'download';
                        try {
                            await downloadDocument(downloadUrl, filename, true);
                        } catch (error) {
                            console.error('Download failed:', error);
                        }
                    }}
                    variant="outline"
                    size="sm"
                >
                    <Download className="w-4 h-4 mr-2" />
                    {t('documents.downloadVideo', 'Download Video')}
                </Button>
            </div>
        </div>
    );
}

export interface DocumentStorageCardProps {
    id: string;
    document: IDocument;
    onDelete?: (document: IDocument) => void;
    onDisassociate?: (document: IDocument) => void;
    onMove?: (document: IDocument) => void;
    hideActions?: boolean;
    showDisassociate?: boolean;
    showMove?: boolean;
    onClick?: () => void;
    isContentDocument?: boolean;
    forceRefresh?: number; // Timestamp to trigger preview refresh
}

// Lazy loading queue to prevent too many concurrent preview generations
class PreviewLoadingQueue {
    private queue: (() => Promise<void>)[] = [];
    private running = 0;
    private maxConcurrent = 3; // Limit concurrent preview generations

    async add(task: () => Promise<void>) {
        return new Promise<void>((resolve, reject) => {
            const wrappedTask = async () => {
                try {
                    this.running++;
                    await task();
                    resolve();
                } catch (error) {
                    reject(error);
                } finally {
                    this.running--;
                    this.processNext();
                }
            };

            if (this.running < this.maxConcurrent) {
                wrappedTask();
            } else {
                this.queue.push(wrappedTask);
            }
        });
    }

    private processNext() {
        if (this.queue.length > 0 && this.running < this.maxConcurrent) {
            const task = this.queue.shift();
            if (task) task();
        }
    }
}

// Singleton instance of the queue
const previewQueue = new PreviewLoadingQueue();

function DocumentStorageCardComponent({
    id,
    document,
    onDelete,
    onDisassociate,
    onMove,
    hideActions = false,
    showDisassociate = false,
    showMove = false,
    onClick,
    isContentDocument = false,
    forceRefresh
}: DocumentStorageCardProps): JSX.Element {
    const { t } = useTranslation('clientPortal');
    const [previewContent, setPreviewContent] = useState<{
        content?: string;
        previewImage?: string;
        error?: string;
    }>({});
    const [isLoading, setIsLoading] = useState(false);
    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
    const [showDisassociateConfirmation, setShowDisassociateConfirmation] = useState(false);
    const [showFullSizeModal, setShowFullSizeModal] = useState(false);
    const [isInView, setIsInView] = useState(false);
    const [hasLoadedPreview, setHasLoadedPreview] = useState(false);
    const cardRef = useRef<HTMLDivElement>(null);

    const documentName = document.document_name || t('documents.unnamed', 'Untitled');
    const isVideoDocument = Boolean(document.mime_type && document.mime_type.startsWith('video/'));
    const deleteTitle = isVideoDocument
        ? t('documents.deleteVideoTitle', 'Delete Video')
        : t('documents.deleteTitle', 'Delete Document');
    const deleteMessage = isVideoDocument
        ? t('documents.deleteVideoMessage', 'Are you sure you want to delete the video "{{name}}"? This action cannot be undone.', { name: documentName })
        : t('documents.deleteMessage', 'Are you sure you want to delete "{{name}}"? This action cannot be undone.', { name: documentName });
    const removeTitle = isVideoDocument
        ? t('documents.removeVideoTitle', 'Remove Video')
        : t('documents.removeTitle', 'Remove Document');
    const removeMessage = isVideoDocument
        ? t('documents.removeVideoMessage', 'Are you sure you want to remove the video "{{name}}" from this item? The file will remain available in the document library.', { name: documentName })
        : t('documents.removeMessage', 'Are you sure you want to remove "{{name}}" from this item? The document will still be available in the document library.', { name: documentName });


    const loadPreview = async () => {
        const identifierForPreview = document.file_id || document.document_id;

        if (!identifierForPreview) {
            console.warn('DocumentStorageCard: No identifier available for preview (document_id or file_id). Document:', document);
            setPreviewContent({ error: 'Preview not available (no identifier)' });
            setIsLoading(false);
            return;
        }


        // Add to queue to prevent overloading
        previewQueue.add(async () => {
            try {
                setIsLoading(true);
                const preview = await getDocumentPreview(identifierForPreview);
                setPreviewContent(preview);
                setHasLoadedPreview(true);
            } catch (error) {
                console.error('Error getting document preview:', error);
                setPreviewContent({ error: 'Failed to load preview' });
            } finally {
                setIsLoading(false);
            }
        });
    };

    // Set up Intersection Observer for lazy loading
    useEffect(() => {
        if (!cardRef.current) return;

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        setIsInView(true);
                    }
                });
            },
            {
                // Start loading when card is 100px away from viewport
                rootMargin: '100px',
                threshold: 0.01
            }
        );

        observer.observe(cardRef.current);

        return () => {
            if (cardRef.current) {
                observer.unobserve(cardRef.current);
            }
        };
    }, []);

    // Load preview only when in view and hasn't been loaded yet
    useEffect(() => {
        if (isInView && !hasLoadedPreview && !isLoading) {
            loadPreview();
        }
        // Only depend on isInView and hasLoadedPreview to prevent unnecessary reloads
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isInView, hasLoadedPreview]);

    // Force refresh preview when forceRefresh prop changes for THIS document
    useEffect(() => {
        if (forceRefresh && forceRefresh > 0 && hasLoadedPreview && isInView) {
            // Clear existing preview and reload
            setPreviewContent({});
            setHasLoadedPreview(false);
            // Add small delay to ensure cache is cleared
            setTimeout(() => {
                loadPreview();
            }, 100);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [forceRefresh]);

    const handleDelete = async () => {
        if (!onDelete) return;
        setShowDeleteConfirmation(true);
    };

    const confirmDelete = async () => {
        if (!onDelete) return;
        
        try {
            setIsLoading(true);
            onDelete(document);
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
            onDisassociate(document);
        } catch (error) {
            console.error('Error disassociating document:', error);
        } finally {
            setIsLoading(false);
            setShowDisassociateConfirmation(false);
        }
    };

    const handleView = async () => {
        // For in-app documents (no file_id), trigger onClick to open editor instead
        if (!document.file_id) {
            if (onClick) {
                onClick();
            }
            return;
        }
        
        // For images, videos, and PDFs, show in modal
        if (document.mime_type?.startsWith('image/') || 
            document.mime_type?.startsWith('video/') || 
            document.mime_type === 'application/pdf') {
            setShowFullSizeModal(true);
        } else {
            // For other files, download
            const downloadUrl = getDocumentDownloadUrl(document.file_id);
            const filename = document.document_name || 'download';
            try {
                await downloadDocument(downloadUrl, filename, true);
            } catch (error) {
                console.error('Download failed:', error);
            }
        }
    };

    const handleFullSizeView = (e: React.MouseEvent) => {
        e.stopPropagation();
        handleView();
    };

    const getFileIcon = () => {
        if (!document.mime_type) return <File className="w-6 h-6" />;

        if (document.mime_type.startsWith('image/')) {
            return <Image className="w-6 h-6" />;
        }
        if (document.mime_type.startsWith('video/')) {
            return <Video className="w-6 h-6" />;
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
            <div
                ref={cardRef}
                className={`bg-white rounded-lg border border-[rgb(var(--color-border-200))] shadow-sm p-4 h-full flex flex-col transition-all hover:border-[rgb(var(--color-border-300))] ${(isContentDocument || !document.file_id) ? 'cursor-pointer' : ''
                }`}
                onClick={(isContentDocument || !document.file_id) && onClick ? (e) => {
                    // Prevent click event if it's coming from the delete button
                    if (e.target instanceof Element &&
                        (e.target.closest('button[id^="delete-document"]') ||
                            e.target.closest('button[id^="disassociate-document"]'))) {
                        return;
                    }
                    onClick();
                } : undefined}
                role={(isContentDocument || !document.file_id) ? "button" : undefined}
                tabIndex={(isContentDocument || !document.file_id) ? 0 : undefined}
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
                    {!isInView ? (
                        <div className="mt-4 flex justify-center h-48 items-center bg-gray-50 rounded">
                            <span className="text-sm text-gray-400">Loading...</span>
                        </div>
                    ) : isLoading ? (
                        <div className="mt-4 flex justify-center">
                            <Spinner size="sm" />
                        </div>
                    ) : previewContent.error ? (
                        <div className="mt-4 flex items-center space-x-2 text-[rgb(var(--color-text-500))]">
                            <EyeOff className="w-4 h-4" />
                            <p className="text-sm">{t('documents.previewUnavailable', 'Preview unavailable')}</p>
                        </div>
                    ) : (
                        <div className="mt-4 preview-container">
                            {/* For videos, show FFmpeg thumbnail if available, otherwise show video preview */}
                            {document.mime_type?.startsWith('video/') && !previewContent.previewImage ? (
                                <VideoPreviewComponent
                                    fileId={document.file_id || ''}
                                    mimeType={document.mime_type || ''}
                                    fileName={document.document_name}
                                    onClick={handleFullSizeView}
                                />
                            ) : previewContent.previewImage ? (
                                <div className="relative group">
                                    <img
                                        src={previewContent.previewImage}
                                        alt={document.document_name}
                                        className="max-w-full h-auto rounded-md border border-[rgb(var(--color-border-200))] cursor-pointer transition-opacity group-hover:opacity-75"
                                        style={{ maxHeight: '200px', objectFit: 'contain' }}
                                        onClick={handleFullSizeView}
                                        role="button"
                                        tabIndex={0}
                                    />
                                    <div 
                                        className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                                        onClick={handleFullSizeView}
                                    >
                                        <div className="bg-black bg-opacity-50 text-white p-2 rounded-full pointer-events-none">
                                            <Eye className="w-6 h-6" />
                                        </div>
                                    </div>
                                </div>
                            ) : previewContent.content ? (
                                <div
                                    className={`text-sm text-[rgb(var(--color-text-700))] max-h-[200px] overflow-hidden p-3 rounded-md bg-[rgb(var(--color-border-50))] border border-[rgb(var(--color-border-200))] ${!document.file_id ? '' : 'cursor-pointer hover:bg-[rgb(var(--color-border-100))] transition-colors'}`}
                                    style={{
                                        display: '-webkit-box',
                                        WebkitLineClamp: '8',
                                        WebkitBoxOrient: 'vertical',
                                        whiteSpace: 'pre-wrap'
                                    }}
                                    dangerouslySetInnerHTML={{ __html: previewContent.content || '' }}
                                    onClick={!document.file_id ? undefined : handleFullSizeView}
                                    role={!document.file_id ? undefined : "button"}
                                    tabIndex={!document.file_id ? undefined : 0}
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
                            onClick={async (e) => {
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
                                    const filename = isPdfTarget ? 
                                        `${document.document_name || 'document'}.pdf` : 
                                        (document.document_name || 'download');
                                    try {
                                        await downloadDocument(downloadUrl, filename, true);
                                    } catch (error) {
                                        console.error('Download failed:', error);
                                    }
                                }
                            }}
                            disabled={isLoading}
                            className="text-[rgb(var(--color-text-600))] hover:text-[rgb(var(--color-text-900))] hover:bg-[rgb(var(--color-border-100))] inline-flex items-center"
                        >
                            <Download className="w-4 h-4 mr-2" />
                            {t('documents.download', 'Download')}
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
                                {isLoading ? t('common.loading', 'Loading...') : t('documents.remove', 'Remove')}
                            </Button>
                        )}
                        {showMove && onMove && (
                            <Button
                                id={`move-document-${document.document_id}-button`}
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                    e.stopPropagation(); // Prevent event bubbling to parent
                                    onMove(document);
                                }}
                                disabled={isLoading}
                                className="text-[rgb(var(--color-text-600))] hover:text-purple-600 hover:bg-purple-50 inline-flex items-center"
                            >
                                <FolderInput className="w-4 h-4 mr-2" />
                                {isLoading ? t('common.loading', 'Loading...') : t('documents.move', 'Move')}
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
                                {isLoading ? t('common.loading', 'Loading...') : t('documents.delete', 'Delete')}
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
            title={deleteTitle}
            message={deleteMessage}
            confirmLabel={t('documents.delete', 'Delete')}
            cancelLabel={t('common.cancel', 'Cancel')}
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
                    title={removeTitle}
                    message={removeMessage}
                    confirmLabel={t('documents.remove', 'Remove')}
                    cancelLabel={t('common.cancel', 'Cancel')}
                    isConfirming={isLoading}
                />
            )
        }

        {/* Full Size View Modal */}
        {showFullSizeModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75" onClick={() => setShowFullSizeModal(false)}>
                <div className={`relative bg-white rounded-lg shadow-xl overflow-hidden ${
                    document.mime_type === 'application/pdf' 
                        ? 'w-[95vw] max-w-6xl h-[90vh]' 
                        : 'max-w-[90vw] max-h-[90vh]'
                }`}>
                    <div className="absolute top-4 right-4 z-10">
                        <Button
                            id={`${id}-close-modal-button`}
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowFullSizeModal(false)}
                            className="bg-black bg-opacity-50 text-white hover:bg-opacity-75 rounded-full p-2"
                        >
                            <X className="w-4 h-4" />
                        </Button>
                    </div>
                    <div className="p-4">
                        <h3 className="text-lg font-semibold mb-4 text-[rgb(var(--color-text-900))]">
                            {document.document_name}
                        </h3>
                        <div className="flex justify-center items-center" onClick={(e) => e.stopPropagation()}>
                            {document.mime_type?.startsWith('image/') ? (
                                <img
                                    src={`/api/documents/view/${document.file_id}`}
                                    alt={document.document_name}
                                    className="max-w-full max-h-[70vh] object-contain"
                                />
                            ) : document.mime_type?.startsWith('video/') ? (
                                <VideoModalComponent 
                                    fileId={document.file_id || ''}
                                    documentId={document.document_id}
                                    mimeType={document.mime_type || ''}
                                    fileName={document.document_name}
                                />
                            ) : document.mime_type === 'application/pdf' ? (
                                <iframe
                                    src={`/api/documents/view/${document.file_id}`}
                                    className="w-full border-0"
                                    style={{ height: 'calc(90vh - 120px)', width: '100%' }}
                                    title={document.document_name}
                                />
                            ) : (
                                <div className="text-center p-8">
                                    <p className="text-[rgb(var(--color-text-500))]">{t('documents.previewUnavailable', 'Preview unavailable')}</p>
                                    <Button
                                        id={`${id}-download-modal-button`}
                                        onClick={async () => {
                                            const downloadUrl = getDocumentDownloadUrl(document.file_id!);
                                            const filename = document.document_name || 'download';
                                            try {
                                                await downloadDocument(downloadUrl, filename, true);
                                            } catch (error) {
                                                console.error('Download failed:', error);
                                            }
                                        }}
                                        className="mt-4"
                                    >
                                        <Download className="w-4 h-4 mr-2" />
                                        {t('documents.downloadFile', 'Download File')}
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        )}
        </>
    );
}

// Memoize the component to prevent unnecessary re-renders
// Only re-render if document, forceRefresh, or callback props change
const DocumentStorageCard = memo(DocumentStorageCardComponent, (prevProps, nextProps) => {
    return (
        prevProps.document.document_id === nextProps.document.document_id &&
        prevProps.forceRefresh === nextProps.forceRefresh &&
        prevProps.onDelete === nextProps.onDelete &&
        prevProps.onDisassociate === nextProps.onDisassociate &&
        prevProps.onMove === nextProps.onMove &&
        prevProps.onClick === nextProps.onClick &&
        prevProps.hideActions === nextProps.hideActions &&
        prevProps.showDisassociate === nextProps.showDisassociate &&
        prevProps.showMove === nextProps.showMove &&
        prevProps.isContentDocument === nextProps.isContentDocument
    );
});

export default DocumentStorageCard;
