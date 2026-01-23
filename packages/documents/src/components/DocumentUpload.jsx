'use client';
import { useState, useRef } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { uploadDocument } from '../actions/documentActions';
import { Upload, X, FileUp } from 'lucide-react';
import Spinner from '@alga-psa/ui/components/Spinner';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import FolderSelectorModal from './FolderSelectorModal';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
export default function DocumentUpload({ id, userId, entityId, entityType, folderPath, onUploadComplete, onCancel }) {
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState(null);
    const fileInputRef = useRef(null);
    const { t } = useTranslation('common');
    // Folder selection state - only used if folderPath not provided
    const [showFolderModal, setShowFolderModal] = useState(false);
    const [pendingFiles, setPendingFiles] = useState([]);
    const [selectedFolderPath, setSelectedFolderPath] = useState(null);
    // Upload queue state
    const [uploadQueue, setUploadQueue] = useState([]);
    const [currentFileIndex, setCurrentFileIndex] = useState(0);
    const handleDragOver = (e) => {
        e.preventDefault();
        setIsDragging(true);
    };
    const handleDragLeave = (e) => {
        e.preventDefault();
        setIsDragging(false);
    };
    const handleDrop = async (e) => {
        e.preventDefault();
        setIsDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            await handleFileSelection(files);
        }
    };
    const handleFileSelect = async (e) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            await handleFileSelection(Array.from(files));
        }
    };
    const handleFileSelection = async (files) => {
        // If folderPath is already provided (e.g., current folder in folder mode), upload directly
        if (folderPath !== undefined) {
            await startBulkUpload(files, folderPath);
        }
        else {
            // Otherwise, always show folder selector to let user choose destination
            setPendingFiles(files);
            setShowFolderModal(true);
        }
    };
    const handleFolderSelected = async (selectedFolder) => {
        if (pendingFiles.length > 0) {
            setSelectedFolderPath(selectedFolder);
            await startBulkUpload(pendingFiles, selectedFolder);
            setPendingFiles([]);
        }
    };
    const startBulkUpload = async (files, targetFolderPath) => {
        // Initialize upload queue
        const queue = files.map(file => ({
            file,
            status: 'pending'
        }));
        setUploadQueue(queue);
        setCurrentFileIndex(0);
        setIsUploading(true);
        setError(null);
        // Process files sequentially
        for (let i = 0; i < files.length; i++) {
            setCurrentFileIndex(i);
            await processFileUpload(i, files[i], targetFolderPath);
        }
        setIsUploading(false);
    };
    const processFileUpload = async (index, file, targetFolderPath) => {
        // Update status to uploading
        setUploadQueue(prev => prev.map((item, idx) => idx === index ? { ...item, status: 'uploading' } : item));
        try {
            const formData = new FormData();
            formData.append('file', file);
            const options = {
                userId,
                folder_path: targetFolderPath ?? null
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
                    case 'contract':
                        options.contractId = entityId;
                        break;
                }
            }
            const result = await uploadDocument(formData, options);
            if (result.success) {
                // Update status to success
                setUploadQueue(prev => prev.map((item, idx) => idx === index ? { ...item, status: 'success', document: result.document } : item));
                // Call onUploadComplete for each successful upload
                onUploadComplete({
                    success: true,
                    document: result.document
                });
            }
            else {
                // Update status to error
                setUploadQueue(prev => prev.map((item, idx) => idx === index ? {
                    ...item,
                    status: 'error',
                    error: result.error || t('documents.uploadSection.error', 'Failed to upload document')
                } : item));
            }
        }
        catch (error) {
            console.error('Error uploading file:', error);
            setUploadQueue(prev => prev.map((item, idx) => idx === index ? {
                ...item,
                status: 'error',
                error: t('documents.uploadSection.fileError', 'Failed to upload file')
            } : item));
        }
    };
    return (<>
            <ReflectionContainer id={id} label={t('documents.uploadSection.reflectionLabel', 'Document Upload')}>
                <div className="space-y-4">
                    <div className={`border-2 border-dashed rounded-lg p-8 text-center ${isDragging ? 'border-purple-500 bg-purple-50' : 'border-gray-300'}`} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
                    <div className="space-y-4">
                        <div className="flex flex-col items-center justify-center text-gray-600">
                            <Upload className={`w-12 h-12 mb-4 ${isDragging ? 'text-purple-500' : 'text-gray-400'}`} strokeWidth={1.5}/>
                            <p className="text-sm">
                                {t('documents.uploadSection.dragDrop', 'Drag and drop your files here, or')}
                            </p>
                            <Button id="select-file-button" type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading} variant="outline" className="mt-2 inline-flex items-center">
                                <FileUp className="w-4 h-4 mr-2"/>
                                {isUploading
            ? t('documents.uploadSection.uploading', 'Uploading...')
            : t('documents.uploadSection.browse', 'Browse Files')}
                            </Button>
                            <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" multiple/>
                        </div>
                        {isUploading && uploadQueue.length > 0 && (<div className="space-y-2">
                                <div className="text-sm text-gray-600 text-center">
                                    {t('documents.uploadSection.uploadingProgress', {
                current: currentFileIndex + 1,
                total: uploadQueue.length,
                defaultValue: `Uploading ${currentFileIndex + 1} of ${uploadQueue.length}`
            })}
                                </div>
                                <div className="max-h-48 overflow-y-auto space-y-2">
                                    {uploadQueue.map((item, index) => (<div key={index} className="flex items-center justify-between text-sm p-2 bg-gray-50 rounded">
                                            <span className="truncate flex-1">{item.file.name}</span>
                                            <span className="ml-2 flex items-center">
                                                {item.status === 'pending' && (<span className="text-gray-400">
                                                        {t('documents.uploadSection.pending', 'Pending')}
                                                    </span>)}
                                                {item.status === 'uploading' && (<Spinner size="sm"/>)}
                                                {item.status === 'success' && (<span className="text-green-600">✓</span>)}
                                                {item.status === 'error' && (<span className="text-red-600" title={item.error}>✗</span>)}
                                            </span>
                                        </div>))}
                                </div>
                            </div>)}
                        {error && (<div className="text-red-500 text-sm flex items-center justify-center">
                                <X className="w-4 h-4 mr-2"/>
                                {error}
                            </div>)}
                    </div>
                </div>
                <div className="flex justify-end space-x-2">
                    <Button id="cancel-button" variant="outline" onClick={onCancel} disabled={isUploading} className="inline-flex items-center">
                        <X className="w-4 h-4 mr-2"/>
                        {t('common.cancel', 'Cancel')}
                    </Button>
                </div>
            </div>
        </ReflectionContainer>

        {/* Folder Selector Modal */}
        <FolderSelectorModal isOpen={showFolderModal} onClose={() => {
            setShowFolderModal(false);
            setPendingFiles([]);
        }} onSelectFolder={handleFolderSelected} title={t('documents.folderSelector.defaultTitle', 'Select Destination Folder')} description={pendingFiles.length > 1
            ? t('documents.folderSelector.multipleDescription', {
                count: pendingFiles.length,
                defaultValue: `Where would you like to save these ${pendingFiles.length} files?`
            })
            : pendingFiles.length === 1
                ? t('documents.folderSelector.singleDescription', {
                    fileName: pendingFiles[0].name,
                    defaultValue: `Where would you like to save "${pendingFiles[0].name}"?`
                })
                : t('documents.folderSelector.defaultDescription', 'Choose where to save this document')}/>
        </>);
}
//# sourceMappingURL=DocumentUpload.jsx.map