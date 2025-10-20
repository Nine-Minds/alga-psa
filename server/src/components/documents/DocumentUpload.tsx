'use client';

import { useState, useRef } from 'react';
import { Button } from '../ui/Button';
import { uploadDocument } from '../../lib/actions/document-actions/documentActions';
import { IDocument } from '../../interfaces/document.interface';
import { Upload, X, FileUp } from 'lucide-react';
import Spinner from 'server/src/components/ui/Spinner';
import { useAutomationIdAndRegister } from '../../types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';
import { ContainerComponent, ButtonComponent, FormFieldComponent } from '../../types/ui-reflection/types';

interface DocumentUploadProps {
    id: string; // Made required since it's needed for reflection registration
    userId: string;
    entityId?: string;
    entityType?: 'ticket' | 'client' | 'contact' | 'asset' | 'project_task';
    folderPath?: string | null;
    onUploadComplete: (result: { success: boolean; document: IDocument }) => void;
    onCancel: () => void;
}

interface UploadOptions {
    userId: string;
    clientId?: string;
    ticketId?: string;
    contactNameId?: string;
    assetId?: string;
    projectTaskId?: string;
    folder_path?: string | null;
}

export default function DocumentUpload({
    id,
    userId,
    entityId,
    entityType,
    folderPath,
    onUploadComplete,
    onCancel
}: DocumentUploadProps): JSX.Element {
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            await handleFileUpload(files[0]);
        }
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            await handleFileUpload(files[0]);
        }
    };

    const handleFileUpload = async (file: File) => {
        setIsUploading(true);
        setError(null);
        try {
            const formData = new FormData();
            formData.append('file', file);

            const options: UploadOptions = {
                userId,
                folder_path: folderPath
            };

            // Add the appropriate entity ID based on type if both are provided
            if (entityId && entityType) {
                switch (entityType) {
                    case 'ticket':
                        options.ticketId = entityId;
                        break;
                    case 'client':
                        options.clientId = entityId;
                        break;
                    case 'contact':
                        options.contactNameId = entityId;
                        break;
                    case 'asset':
                        options.assetId = entityId;
                        break;
                    case 'project_task':
                        options.projectTaskId = entityId;
                        break;
                }
            }

            console.log('Uploading document with options:', options); // Debug log

            const result = await uploadDocument(formData, options);

            if (result.success) {
                console.log('Upload successful:', result.document); // Debug log
                onUploadComplete({
                    success: true,
                    document: result.document
                });
            } else {
                console.error('Upload failed:', result.error);
                setError(result.error || 'Failed to upload document');
            }
        } catch (error) {
            console.error('Error uploading file:', error);
            setError('Failed to upload file');
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <ReflectionContainer id={id} label="Document Upload">
            <div className="space-y-4">
                <div
                    className={`border-2 border-dashed rounded-lg p-8 text-center ${
                        isDragging ? 'border-purple-500 bg-purple-50' : 'border-gray-300'
                    }`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    <div className="space-y-4">
                        <div className="flex flex-col items-center justify-center text-gray-600">
                            <Upload
                                className={`w-12 h-12 mb-4 ${isDragging ? 'text-purple-500' : 'text-gray-400'}`}
                                strokeWidth={1.5}
                            />
                            <p className="text-sm">Drag and drop your file here, or</p>
                            <Button
                                id="select-file-button"
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isUploading}
                                variant="outline"
                                className="mt-2 inline-flex items-center"
                            >
                                <FileUp className="w-4 h-4 mr-2" />
                                {isUploading ? 'Uploading...' : 'Browse Files'}
                            </Button>
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileSelect}
                                className="hidden"
                            />
                        </div>
                        {isUploading && (
                            <div className="flex justify-center">
                                <Spinner size="sm" />
                            </div>
                        )}
                        {error && (
                            <div className="text-red-500 text-sm flex items-center justify-center">
                                <X className="w-4 h-4 mr-2" />
                                {error}
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex justify-end space-x-2">
                    <Button
                        id="cancel-button"
                        variant="outline"
                        onClick={onCancel}
                        disabled={isUploading}
                        className="inline-flex items-center"
                    >
                        <X className="w-4 h-4 mr-2" />
                        Cancel
                    </Button>
                </div>
            </div>
        </ReflectionContainer>
    );
}
