"use client";

import { useState, useEffect } from 'react';
import type { IDocument } from '@alga-psa/types';
import Image from 'next/image';
import { getDocumentPreview } from '../actions/documentActions';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface DocumentPreviewProps {
    document: IDocument;
    className?: string;
}

const DocumentPreview = ({ document, className }: DocumentPreviewProps): React.JSX.Element | null => {
    const { t } = useTranslation('features/documents');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [preview, setPreview] = useState<{
        content?: string;
        previewImage?: string;
        pageCount?: number;
    } | null>(null);

    useEffect(() => {
        const loadPreview = async () => {
            if (!document.file_id || !document.mime_type) {
                setIsLoading(false);
                return;
            }

            try {
                const mime = document.mime_type.toLowerCase();

                // Handle images directly
                if (mime.startsWith('image/')) {
                    setPreview(null); // We'll use Image component for images
                    setIsLoading(false);
                    return;
                }

                // Get preview for other file types
                const result = await getDocumentPreview(document.file_id);
                if (isActionPermissionError(result)) {
                    throw new Error(result.permissionError);
                }
                if (result.success) {
                    setPreview({
                        content: result.content,
                        previewImage: result.previewImage,
                        pageCount: result.pageCount
                    });
                } else {
                    throw new Error(result.error || 'Failed to load preview');
                }
            } catch (err) {
                console.error('Failed to load document preview:', err);
                setError(t('previewLoadFailed', { defaultValue: 'Failed to load preview' }));
            } finally {
                setIsLoading(false);
            }
        };

        loadPreview();
    }, [document.file_id, document.mime_type]);

    if (!document.file_id || !document.mime_type) return null;

    const mime = document.mime_type.toLowerCase();

    // Loading state
    if (isLoading) {
        return (
            <div className={`flex items-center justify-center h-48 bg-[rgb(var(--color-border-100))] rounded-md ${className}`}>
                <span className="text-[rgb(var(--color-text-600))]">
                    {t('previewPane.loading', { defaultValue: 'Loading preview...' })}
                </span>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className={`flex items-center justify-center h-48 bg-red-500/10 rounded-md ${className}`}>
                <span className="text-red-600">{error}</span>
            </div>
        );
    }

    // Image preview
    if (mime.startsWith('image/')) {
        return (
            <div className={`relative w-full h-48 ${className}`}>
                <Image
                    src={`/api/documents/view/${document.file_id}/preview`}
                    alt={document.document_name}
                    fill
                    className="object-contain rounded-md"
                />
            </div>
        );
    }

    // PDF preview
    if (mime === 'application/pdf' && preview) {
        return (
            <div className={`h-48 bg-[rgb(var(--color-border-100))] rounded-md overflow-hidden ${className}`}>
                {preview.previewImage ? (
                    <div className="relative w-full h-full">
                        {/* Preview image — invert in dark mode so white PDF pages become dark */}
                        <Image
                            src={preview.previewImage}
                            alt={t('previewPane.altPdf', { defaultValue: 'Preview of {{name}}', name: document.document_name })}
                            fill
                            className="object-contain dark:invert dark:hue-rotate-180"
                        />
                        {/* Page count overlay — omitted entirely when the count is
                            unknown, rather than asserting "0 pages" for a PDF whose
                            page count simply was not extracted. */}
                        {preview.pageCount != null && (
                            <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-sm p-2 text-center">
                                {t('previewPane.pageCount', {
                                    defaultValue_one: '{{count}} page',
                                    defaultValue_other: '{{count}} pages',
                                    count: preview.pageCount,
                                })}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center">
                            <p className="text-[rgb(var(--color-text-600))] font-medium">
                                {t('previewPane.pdfDocument', { defaultValue: 'PDF Document' })}
                            </p>
                            {preview.pageCount != null && (
                                <p className="text-sm text-[rgb(var(--color-text-500))]">
                                    {t('previewPane.pageCount', {
                                        defaultValue_one: '{{count}} page',
                                        defaultValue_other: '{{count}} pages',
                                        count: preview.pageCount,
                                    })}
                                </p>
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // Markdown preview
    if ((mime === 'text/markdown' || document.document_name.endsWith('.md')) && preview?.content) {
        return (
            <div 
                className={`h-48 p-4 bg-[rgb(var(--color-card))] rounded-md overflow-auto prose prose-sm max-w-none ${className}`}
                dangerouslySetInnerHTML={{ __html: preview.content }}
            />
        );
    }

    // Text preview (including JSON)
    if ((mime.startsWith('text/') || mime === 'application/json') && preview?.content) {
        return (
            <div className={`h-48 p-4 bg-[rgb(var(--color-border-100))] rounded-md overflow-auto ${className}`}>
                <pre className="text-sm whitespace-pre-wrap font-mono">
                    {preview.content}
                </pre>
            </div>
        );
    }

    // Video preview with thumbnail
    if (mime.startsWith('video/')) {
        if (preview?.previewImage) {
            return (
                <div className={`relative w-full h-48 ${className}`}>
                    <Image
                        src={preview.previewImage}
                        alt={t('previewPane.altVideoThumbnail', { defaultValue: 'Thumbnail of {{name}}', name: document.document_name })}
                        fill
                        className="object-contain rounded-md bg-black"
                    />
                    {/* Video play icon overlay */}
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="bg-black bg-opacity-50 rounded-full p-4">
                            <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z"/>
                            </svg>
                        </div>
                    </div>
                </div>
            );
        }
        // Fallback for videos without thumbnails
        return (
            <div className={`flex items-center justify-center h-48 bg-gray-900 rounded-md ${className}`}>
                <div className="text-center">
                    <svg className="w-16 h-16 text-[rgb(var(--color-text-400))] mx-auto mb-2" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z"/>
                    </svg>
                    <span className="text-[rgb(var(--color-text-400))]">
                        {t('previewPane.videoFile', { defaultValue: 'Video File' })}
                    </span>
                </div>
            </div>
        );
    }

    // Default preview for unsupported types
    return (
        <div className={`flex items-center justify-center h-48 bg-[rgb(var(--color-border-100))] rounded-md ${className}`}>
            <span className="text-[rgb(var(--color-text-600))]">
                {t('previewPane.notAvailable', { defaultValue: 'Preview not available' })}
            </span>
        </div>
    );
};

export default DocumentPreview;
