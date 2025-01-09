'use client';

import { useState, useEffect } from 'react';
import { IDocument } from '../../interfaces/document.interface';
import { getDocumentPreview } from '../../lib/actions/document-actions/documentActions';
import { getDocumentDownloadUrl } from '../../lib/utils/documentUtils';
import { Button } from '../ui/Button';
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
    Unlink
} from 'lucide-react';
import { useAutomationIdAndRegister } from '../../types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';
import { ContainerComponent, ButtonComponent } from '../../types/ui-reflection/types';

export interface DocumentStorageCardProps {
    id: string; // Made required since it's needed for reflection registration
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
        try {
            setIsLoading(true);
            await onDelete(document);
        } catch (error) {
            console.error('Error deleting document:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDisassociate = async () => {
        if (!onDisassociate) return;
        try {
            setIsLoading(true);
            await onDisassociate(document);
        } catch (error) {
            console.error('Error disassociating document:', error);
        } finally {
            setIsLoading(false);
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

    return (
        <ReflectionContainer id={id} label={`Document Card - ${document.document_name}`}>
            <div 
                {...useAutomationIdAndRegister<ContainerComponent>({
                    id: `${id}-card`,
                    type: 'container',
                    label: 'Document Card'
                }).automationIdProps}
                className={`bg-white rounded-lg border border-[rgb(var(--color-border-200))] shadow-sm p-4 h-full flex flex-col transition-all hover:border-[rgb(var(--color-border-300))] ${
                    isContentDocument ? 'cursor-pointer' : ''
                }`}
                onClick={isContentDocument && onClick ? onClick : undefined}
                role={isContentDocument ? "button" : undefined}
                tabIndex={isContentDocument ? 0 : undefined}
            >
                <div className="flex-1">
                    <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0 mr-2">
                            <div className="flex items-center space-x-2">
                                {getFileIcon()}
                                <h3 {...useAutomationIdAndRegister<ContainerComponent>({
                                    id: `${id}-name`,
                                    type: 'container',
                                    label: 'Document Name'
                                }).automationIdProps} className="text-sm font-medium text-[rgb(var(--color-text-900))] truncate">
                                    {document.document_name}
                                </h3>
                            </div>
                            <p {...useAutomationIdAndRegister<ContainerComponent>({
                                id: `${id}-author`,
                                type: 'container',
                                label: 'Author'
                            }).automationIdProps} className="mt-1 text-xs text-[rgb(var(--color-text-500))] truncate">
                                {document.createdByFullName || document.created_by}
                            </p>
                            {document.type_name && (
                                <p {...useAutomationIdAndRegister<ContainerComponent>({
                                    id: `${id}-type`,
                                    type: 'container',
                                    label: 'Document Type'
                                }).automationIdProps} className="mt-1 text-xs text-[rgb(var(--color-text-500))] truncate">
                                    Type: {document.type_name}
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="space-y-1">
                        {document.mime_type && (
                            <p {...useAutomationIdAndRegister<ContainerComponent>({
                                id: `${id}-mime-type`,
                                type: 'container',
                                label: 'MIME Type'
                            }).automationIdProps} className="text-xs text-[rgb(var(--color-text-500))]">
                                {document.mime_type}
                            </p>
                        )}

                        {document.file_size && (
                            <p {...useAutomationIdAndRegister<ContainerComponent>({
                                id: `${id}-size`,
                                type: 'container',
                                label: 'File Size'
                            }).automationIdProps} className="text-xs text-[rgb(var(--color-text-500))]">
                                Size: {(document.file_size / 1024).toFixed(1)} KB
                            </p>
                        )}
                    </div>

                    {/* Preview Content */}
                    {isLoading ? (
                        <div {...useAutomationIdAndRegister<ContainerComponent>({
                            id: `${id}-loading`,
                            type: 'container',
                            label: 'Loading'
                        }).automationIdProps} className="mt-4 flex justify-center">
                            <Loader2 className="animate-spin h-8 w-8 text-[rgb(var(--color-primary-400))]" />
                        </div>
                    ) : previewContent.error ? (
                        <p {...useAutomationIdAndRegister<ContainerComponent>({
                            id: `${id}-error`,
                            type: 'container',
                            label: 'Error Message'
                        }).automationIdProps} className="mt-4 text-sm text-red-500">{previewContent.error}</p>
                    ) : (
                        <div {...useAutomationIdAndRegister<ContainerComponent>({
                            id: `${id}-preview`,
                            type: 'container',
                            label: 'Preview'
                        }).automationIdProps} className="mt-4 preview-container">
                            {previewContent.previewImage ? (
                                <img
                                    {...useAutomationIdAndRegister<ContainerComponent>({
                                        id: `${id}-preview-image`,
                                        type: 'container',
                                        label: 'Preview Image'
                                    }).automationIdProps}
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
                                    {...useAutomationIdAndRegister<ContainerComponent>({
                                        id: `${id}-preview-content`,
                                        type: 'container',
                                        label: 'Preview Content'
                                    }).automationIdProps}
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
                    <div className="mt-4 pt-3 flex justify-end space-x-2 border-t border-[rgb(var(--color-border-100))]">
                        <a
                            {...useAutomationIdAndRegister<ButtonComponent>({
                                id: `${id}-download-btn`,
                                type: 'button',
                                label: 'Download',
                                actions: ['click'],
                                disabled: isLoading || !document.file_id
                            }).automationIdProps}
                            href={document.file_id ? getDocumentDownloadUrl(document.file_id) : '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 h-9 px-3 ${
                                isLoading || !document.file_id
                                    ? 'opacity-50 cursor-not-allowed'
                                    : 'text-[rgb(var(--color-text-600))] hover:text-[rgb(var(--color-text-900))] hover:bg-[rgb(var(--color-border-100))]'
                            }`}
                            onClick={(e) => {
                                if (isLoading || !document.file_id) {
                                    e.preventDefault();
                                }
                            }}
                        >
                            <Download className="w-4 h-4 mr-2" />
                            Download
                        </a>
                        {showDisassociate && onDisassociate && (
                            <Button
                                {...useAutomationIdAndRegister<ButtonComponent>({
                                    id: `${id}-disassociate-btn`,
                                    type: 'button',
                                    label: 'Remove',
                                    actions: ['click'],
                                    disabled: isLoading
                                }).automationIdProps}
                                variant="ghost"
                                size="sm"
                                onClick={handleDisassociate}
                                disabled={isLoading}
                                className="text-[rgb(var(--color-text-600))] hover:text-orange-600 hover:bg-orange-50 inline-flex items-center"
                            >
                                <Unlink className="w-4 h-4 mr-2" />
                                {isLoading ? 'Removing...' : 'Remove'}
                            </Button>
                        )}
                        {onDelete && (
                            <Button
                                {...useAutomationIdAndRegister<ButtonComponent>({
                                    id: `${id}-delete-btn`,
                                    type: 'button',
                                    label: 'Delete',
                                    actions: ['click'],
                                    disabled: isLoading
                                }).automationIdProps}
                                variant="ghost"
                                size="sm"
                                onClick={handleDelete}
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
    );
}
