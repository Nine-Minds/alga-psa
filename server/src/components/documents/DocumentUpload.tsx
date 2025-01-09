'use client';

import { useState, useRef } from 'react';
import { Button } from '../ui/Button';
import { uploadDocument } from '../../lib/actions/document-actions/documentActions';
import { IDocument } from '../../interfaces/document.interface';
import { Upload, X, Loader2, FileUp } from 'lucide-react';
import { useAutomationIdAndRegister } from '../../types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';
import { ContainerComponent, ButtonComponent, FormFieldComponent } from '../../types/ui-reflection/types';

interface DocumentUploadProps {
    id: string; // Made required since it's needed for reflection registration
    userId: string;
    entityId?: string;
    entityType?: 'ticket' | 'company' | 'contact' | 'schedule' | 'asset';
    onUploadComplete: (result: { success: boolean; document: IDocument }) => void;
    onCancel: () => void;
}

interface UploadOptions {
    userId: string;
    companyId?: string;
    ticketId?: string;
    contactNameId?: string;
    scheduleId?: string;
    assetId?: string;
}

export default function DocumentUpload({
    id,
    userId,
    entityId,
    entityType,
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
                userId
            };

            // Add the appropriate entity ID based on type if both are provided
            if (entityId && entityType) {
                switch (entityType) {
                    case 'ticket':
                        options.ticketId = entityId;
                        break;
                    case 'company':
                        options.companyId = entityId;
                        break;
                    case 'contact':
                        options.contactNameId = entityId;
                        break;
                    case 'schedule':
                        options.scheduleId = entityId;
                        break;
                    case 'asset':
                        options.assetId = entityId;
                        break;
                }
            }

            console.log('Uploading document with options:', options); // Debug log

            const result = await uploadDocument(formData, options);

            if (result.success && result.document) {
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
                    {...useAutomationIdAndRegister<ContainerComponent>({
                        id: `${id}-drop-zone`,
                        type: 'container',
                        label: 'Drop Zone'
                    }).automationIdProps}
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
                                {...useAutomationIdAndRegister<ButtonComponent>({
                                    id: `${id}-browse-btn`,
                                    type: 'button',
                                    label: 'Browse Files',
                                    actions: ['click'],
                                    disabled: isUploading
                                }).automationIdProps}
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
                                {...useAutomationIdAndRegister<ButtonComponent>({
                                    id: `${id}-file-input`,
                                    type: 'button',
                                    label: 'File Input',
                                    actions: ['click']
                                }).automationIdProps}
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileSelect}
                                className="hidden"
                            />
                        </div>
                        {isUploading && (
                            <div {...useAutomationIdAndRegister<ContainerComponent>({
                                id: `${id}-loading`,
                                type: 'container',
                                label: 'Loading'
                            }).automationIdProps} className="flex justify-center">
                                <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
                            </div>
                        )}
                        {error && (
                            <div {...useAutomationIdAndRegister<ContainerComponent>({
                                id: `${id}-error`,
                                type: 'container',
                                label: 'Error Message'
                            }).automationIdProps} className="text-red-500 text-sm flex items-center justify-center">
                                <X className="w-4 h-4 mr-2" />
                                {error}
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex justify-end space-x-2">
                    <Button
                        {...useAutomationIdAndRegister<ButtonComponent>({
                            id: `${id}-cancel-btn`,
                            type: 'button',
                            label: 'Cancel',
                            actions: ['click'],
                            disabled: isUploading
                        }).automationIdProps}
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
