"use client";

import { useState, useEffect } from 'react';
import { IDocument } from 'server/src/interfaces/document.interface';
import Image from 'next/image';
import { getDocumentPreview } from 'server/src/lib/actions/document-actions/documentActions';

interface DocumentPreviewProps {
    document: IDocument;
    className?: string;
}

const DocumentPreview = ({ document, className }: DocumentPreviewProps): JSX.Element | null => {
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
                setError(err instanceof Error ? err.message : 'Failed to load preview');
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
            <div className={`flex items-center justify-center h-48 bg-gray-100 rounded-md ${className}`}>
                <span className="text-gray-600">Loading preview...</span>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className={`flex items-center justify-center h-48 bg-red-50 rounded-md ${className}`}>
                <span className="text-red-600">{error}</span>
            </div>
        );
    }

    // Image preview
    if (mime.startsWith('image/')) {
        return (
            <div className={`relative w-full h-48 ${className}`}>
                <Image
                    src={`/api/files/${document.file_id}/preview`}
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
            <div className={`h-48 bg-gray-100 rounded-md overflow-hidden ${className}`}>
                {preview.previewImage ? (
                    <div className="relative w-full h-full">
                        {/* Preview image */}
                        <Image
                            src={preview.previewImage}
                            alt={`Preview of ${document.document_name}`}
                            fill
                            className="object-contain"
                        />
                        {/* Page count overlay */}
                        <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-sm p-2 text-center">
                            {preview.pageCount} {preview.pageCount === 1 ? 'page' : 'pages'}
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center">
                            <p className="text-gray-600 font-medium">PDF Document</p>
                            <p className="text-sm text-gray-500">
                                {preview.pageCount} {preview.pageCount === 1 ? 'page' : 'pages'}
                            </p>
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
                className={`h-48 p-4 bg-white rounded-md overflow-auto prose prose-sm max-w-none ${className}`}
                dangerouslySetInnerHTML={{ __html: preview.content }}
            />
        );
    }

    // Text preview (including JSON)
    if ((mime.startsWith('text/') || mime === 'application/json') && preview?.content) {
        return (
            <div className={`h-48 p-4 bg-gray-100 rounded-md overflow-auto ${className}`}>
                <pre className="text-sm whitespace-pre-wrap font-mono">
                    {preview.content}
                </pre>
            </div>
        );
    }

    // Default preview for unsupported types
    return (
        <div className={`flex items-center justify-center h-48 bg-gray-100 rounded-md ${className}`}>
            <span className="text-gray-600">Preview not available</span>
        </div>
    );
};

export default DocumentPreview;
