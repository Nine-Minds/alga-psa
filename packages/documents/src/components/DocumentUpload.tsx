'use client';

import { useState, useRef } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { uploadDocument } from '../actions/documentActions';
import type { IDocument } from '@alga-psa/types';
import {
    isActionPermissionError,
    isActionMessageError,
} from '@alga-psa/ui/lib/errorHandling';
import { Upload, X, FileUp, Check, AlertCircle } from 'lucide-react';
import Spinner from '@alga-psa/ui/components/Spinner';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import FolderSelectorModal from './FolderSelectorModal';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import AssociatedEntityPicker, { type PickerAssociationEntityType } from './AssociatedEntityPicker';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import toast from 'react-hot-toast';

/** Terminal counts for one bulk upload batch, passed to `onAllUploadsComplete`. */
export interface DocumentUploadBatchSummary {
    total: number;
    succeeded: number;
    failed: number;
}

interface DocumentUploadProps {
    id: string; // Made required since it's needed for reflection registration
    userId: string;
    entityId?: string;
    entityType?: 'ticket' | 'client' | 'contact' | 'asset' | 'project_task' | 'contract';
    folderPath?: string | null;
    onUploadComplete: (result: { success: boolean; document: IDocument }) => void | Promise<void>;
    /**
     * Called once after all files in a multi-file upload have been processed,
     * with terminal totals for the batch. May be async; a rejected promise is
     * reported separately and never relabels a stored file as failed.
     */
    onAllUploadsComplete?: (summary: DocumentUploadBatchSummary) => void | Promise<void>;
    onCancel: () => void;
    /** Override the default folder-fetching function (e.g. for client portal) */
    getFoldersFn?: () => Promise<string[]>;
}

interface UploadOptions {
    userId: string;
    clientId?: string;
    ticketId?: string;
    contactNameId?: string;
    assetId?: string;
    projectTaskId?: string;
    contractId?: string;
    folder_path?: string | null;
}

type UploadStatus = 'pending' | 'uploading' | 'success' | 'error';

interface FileUploadStatus {
    file: File;
    status: UploadStatus;
    error?: string;
    document?: IDocument;
}

interface FileAttemptResult {
    file: File;
    status: 'success' | 'error';
    error?: string;
    document?: IDocument;
}

const UPLOAD_ASSOCIATION_ENTITY_TYPES: PickerAssociationEntityType[] = [
    'client',
    'contact',
    'ticket',
    'asset',
    'project_task',
    'contract',
];

export default function DocumentUpload({
    id,
    userId,
    entityId,
    entityType,
    folderPath,
    onUploadComplete,
    onAllUploadsComplete,
    onCancel,
    getFoldersFn
}: DocumentUploadProps): React.JSX.Element {
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showEmptyDrop, setShowEmptyDrop] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    // Synchronous guard — state updates are async, so a second drop could slip
    // into the same tick and replace the running batch.
    const isUploadingRef = useRef(false);
    const { t } = useTranslation('common');
    const [selectedEntityType, setSelectedEntityType] = useState<string>('');
    const [selectedEntityId, setSelectedEntityId] = useState<string>('');
    const [selectedEntityLabel, setSelectedEntityLabel] = useState<string | undefined>();
    const canSelectAssociation = !entityId && !entityType;

    // Folder selection state - only used if folderPath not provided
    const [showFolderModal, setShowFolderModal] = useState(false);
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null);

    // Upload queue state
    const [uploadQueue, setUploadQueue] = useState<FileUploadStatus[]>([]);
    const [currentFileIndex, setCurrentFileIndex] = useState<number>(0);

    const resetFileInput = () => {
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const announceUploadInProgress = () => {
        toast(t('documents.uploadSection.uploadInProgress', 'An upload is already in progress. Wait for it to finish before adding more files.'));
    };

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
        if (isUploadingRef.current) {
            announceUploadInProgress();
            return;
        }
        // A drag that supplies no browser File objects (for example an Outlook
        // message drag) must not be treated as an upload attempt.
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length === 0) {
            setShowEmptyDrop(true);
            toast(t('documents.uploadSection.emptyDropMessage', 'No files were received. Save the attachment or email to your computer, then drag the saved file here or use Browse Files.'));
            return;
        }
        setShowEmptyDrop(false);
        await handleFileSelection(files);
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files ? Array.from(e.target.files) : [];
        // Reset immediately so selecting the same file again fires onChange.
        resetFileInput();
        if (files.length > 0) {
            await handleFileSelection(files);
        }
    };

    const handleFileSelection = async (files: File[]) => {
        if (isUploadingRef.current) {
            announceUploadInProgress();
            return;
        }

        if (canSelectAssociation && selectedEntityType && !selectedEntityId) {
            setError(t('documents.uploadSection.selectAssociatedEntityError', 'Select an associated entity before uploading.'));
            return;
        }

        setShowEmptyDrop(false);

        // If folderPath is already provided (e.g., current folder in folder mode), upload directly
        if (folderPath !== undefined) {
            await startBulkUpload(files, folderPath);
        } else {
            // Otherwise, always show folder selector to let user choose destination
            setPendingFiles(files);
            setShowFolderModal(true);
        }
    };

    const handleFolderSelected = async (selectedFolder: string | null) => {
        // Capture the pending files synchronously: the modal's onClose also
        // clears them immediately after this callback returns.
        const files = pendingFiles;
        setPendingFiles([]);
        setSelectedFolderPath(selectedFolder);
        if (files.length > 0) {
            await startBulkUpload(files, selectedFolder);
        }
    };

    const startBulkUpload = async (files: File[], targetFolderPath: string | null | undefined) => {
        if (files.length === 0) return;

        if (isUploadingRef.current) {
            announceUploadInProgress();
            return;
        }
        // Set the guard before any await so overlapping drops cannot replace it.
        isUploadingRef.current = true;

        // A newly started batch replaces previous outcomes.
        const queue: FileUploadStatus[] = files.map(file => ({
            file,
            status: 'pending' as const
        }));
        setUploadQueue(queue);
        setCurrentFileIndex(0);
        setIsUploading(true);
        setError(null);
        setShowEmptyDrop(false);
        resetFileInput();

        // Accumulate terminal outcomes locally so the summary does not depend
        // on React state timing.
        const outcomes: FileAttemptResult[] = [];
        try {
            for (let i = 0; i < files.length; i++) {
                setCurrentFileIndex(i);
                outcomes.push(await processFileUpload(i, files[i], targetFolderPath));
            }
        } finally {
            setIsUploading(false);
            isUploadingRef.current = false;
            resetFileInput();
        }

        const succeeded = outcomes.filter(outcome => outcome.status === 'success').length;
        const failed = outcomes.length - succeeded;
        const summary: DocumentUploadBatchSummary = {
            total: outcomes.length,
            succeeded,
            failed,
        };

        // One failure notification per batch. Per-file permission errors are
        // recorded inline instead of announcing a toast each, so the summary is
        // the single announcement.
        if (failed > 0) {
            toast.error(t('documents.uploadSection.failureSummary', {
                failed,
                total: outcomes.length,
                defaultValue: `${failed} of ${outcomes.length} files could not be uploaded. Review the errors below.`
            }));
        }

        if (onAllUploadsComplete) {
            try {
                await onAllUploadsComplete(summary);
            } catch (callbackError) {
                console.error('Uploads completed but onAllUploadsComplete handler failed:', callbackError);
                if (succeeded > 0) {
                    toast.error(t('documents.uploadSection.refreshFailed', 'Your files were uploaded, but the document list could not refresh. Reload the page to see them.'));
                }
            }
        }
    };

    const processFileUpload = async (index: number, file: File, targetFolderPath: string | null | undefined): Promise<FileAttemptResult> => {
        // Update status to uploading
        setUploadQueue(prev => prev.map((item, idx) =>
            idx === index ? { ...item, status: 'uploading' as const, error: undefined } : item
        ));

        let outcome: FileAttemptResult;

        try {
            const formData = new FormData();
            formData.append('file', file);

            const options: UploadOptions = {
                userId,
                folder_path: targetFolderPath ?? null
            };

            const effectiveEntityType = entityType ?? selectedEntityType;
            const effectiveEntityId = entityId ?? selectedEntityId;

            // Add the appropriate entity ID based on type if both are provided
            if (effectiveEntityId && effectiveEntityType) {
                switch (effectiveEntityType) {
                    case 'ticket':
                        options.ticketId = effectiveEntityId;
                        break;
                    case 'client':
                        options.clientId = effectiveEntityId;
                        break;
                    case 'contact':
                        options.contactNameId = effectiveEntityId;
                        break;
                    case 'asset':
                        options.assetId = effectiveEntityId;
                        break;
                    case 'project_task':
                        options.projectTaskId = effectiveEntityId;
                        break;
                    case 'contract':
                        options.contractId = effectiveEntityId;
                        break;
                }
            }

            const result = await uploadDocument(formData, options);

            if (isActionPermissionError(result)) {
                outcome = { file, status: 'error', error: result.permissionError };
            } else if (isActionMessageError(result)) {
                outcome = { file, status: 'error', error: result.actionError };
            } else if (result.success) {
                outcome = { file, status: 'success', document: result.document };
            } else {
                const returnedError = (result as { success: false; error?: string }).error;
                outcome = {
                    file,
                    status: 'error',
                    error: returnedError && returnedError.trim()
                        ? returnedError
                        : t('documents.uploadSection.error', 'Failed to upload document')
                };
            }
        } catch (uploadError) {
            // A thrown or opaque transport error carries no trustworthy cause;
            // use a safe localized fallback rather than exposing internals.
            console.error('Error uploading file:', uploadError);
            outcome = {
                file,
                status: 'error',
                error: t('documents.uploadSection.fileError', 'Failed to upload file')
            };
        }

        // Persist the terminal outcome in the queue.
        setUploadQueue(prev => prev.map((item, idx) =>
            idx === index ? {
                ...item,
                status: outcome.status,
                error: outcome.error,
                document: outcome.document
            } : item
        ));

        // Consumer callbacks are isolated from upload failure: a rejected
        // handler must never relabel an already-stored file as failed.
        if (outcome.status === 'success' && outcome.document) {
            try {
                await onUploadComplete({ success: true, document: outcome.document });
            } catch (callbackError) {
                console.error('Document uploaded but onUploadComplete handler failed:', callbackError);
            }
        }

        return outcome;
    };

    const succeededCount = uploadQueue.filter(item => item.status === 'success').length;

    return (
        <>
            <ReflectionContainer
                id={id}
                label={t('documents.uploadSection.reflectionLabel', 'Document Upload')}
            >
                <div className="space-y-4">
                    {canSelectAssociation && (
                        <AssociatedEntityPicker
                            id={`${id}-associated-entity`}
                            entityType={selectedEntityType}
                            entityId={selectedEntityId}
                            selectedEntityLabel={selectedEntityLabel}
                            allowedEntityTypes={UPLOAD_ASSOCIATION_ENTITY_TYPES}
                            noEntityTypeLabel={t('documents.uploadSection.noAssociation', 'No association')}
                            entityTypeLabel={t('documents.uploadSection.associatedEntityTypeLabel', 'Associate With')}
                            disabled={isUploading}
                            onEntityTypeChange={setSelectedEntityType}
                            onEntityChange={(value: string, label?: string) => {
                                setSelectedEntityId(value);
                                setSelectedEntityLabel(label);
                            }}
                        />
                    )}

                    <div
                    className={`border-2 border-dashed rounded-lg p-8 text-center ${
                        isDragging ? 'border-[rgb(var(--color-primary-500))] bg-[rgb(var(--color-primary-50))]' : 'border-[rgb(var(--color-border-300))]'
                    }`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    aria-busy={isUploading}
                >
                    <div className="space-y-4">
                        <div className="flex flex-col items-center justify-center text-[rgb(var(--color-text-600))]">
                            <Upload
                                className={`w-12 h-12 mb-4 ${isDragging ? 'text-[rgb(var(--color-primary-500))]' : 'text-[rgb(var(--color-text-400))]'}`}
                                strokeWidth={1.5}
                            />
                            <p className="text-sm">
                                {t('documents.uploadSection.dragDrop', 'Drag and drop your files here, or')}
                            </p>
                            <Button
                                id="select-file-button"
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isUploading}
                                variant="outline"
                                className="mt-2 inline-flex items-center"
                            >
                                <FileUp className="w-4 h-4 mr-2" />
                                {isUploading
                                    ? t('documents.uploadSection.uploading', 'Uploading...')
                                    : t('documents.uploadSection.browse', 'Browse Files')}
                            </Button>
                            <input
                                type="file"
                                id={`${id}-file-input`}
                                ref={fileInputRef}
                                onChange={handleFileSelect}
                                className="hidden"
                                multiple
                                disabled={isUploading}
                            />
                        </div>

                        {showEmptyDrop && (
                            <Alert
                                id={`${id}-empty-drop-alert`}
                                variant="warning"
                                className="text-left"
                            >
                                <AlertTitle>
                                    {t('documents.uploadSection.emptyDropTitle', 'No files received')}
                                </AlertTitle>
                                <AlertDescription>
                                    {t('documents.uploadSection.emptyDropMessage', 'No files were received. Save the attachment or email to your computer, then drag the saved file here or use Browse Files.')}
                                </AlertDescription>
                            </Alert>
                        )}

                        {uploadQueue.length > 0 && (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="text-sm text-[rgb(var(--color-text-600))] text-center flex-1">
                                        {isUploading
                                            ? t('documents.uploadSection.uploadingProgress', {
                                                current: currentFileIndex + 1,
                                                total: uploadQueue.length,
                                                defaultValue: `Uploading ${currentFileIndex + 1} of ${uploadQueue.length}`
                                            })
                                            : t('documents.uploadSection.outcomeSummary', {
                                                succeeded: succeededCount,
                                                total: uploadQueue.length,
                                                defaultValue: `${succeededCount} of ${uploadQueue.length} files uploaded`
                                            })}
                                    </div>
                                    {!isUploading && (
                                        <Button
                                            id={`${id}-clear-results-button`}
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                                setUploadQueue([]);
                                                setShowEmptyDrop(false);
                                            }}
                                        >
                                            {t('documents.uploadSection.clearResults', 'Clear results')}
                                        </Button>
                                    )}
                                </div>
                                <div
                                    role="status"
                                    aria-live="polite"
                                    aria-label={t('documents.uploadSection.reflectionLabel', 'Document Upload')}
                                    className="max-h-48 overflow-y-auto space-y-2"
                                >
                                    {uploadQueue.map((item, index) => (
                                        <div
                                            key={`${item.file.name}-${index}`}
                                            className="flex flex-col gap-1 text-sm p-2 bg-[rgb(var(--color-border-50))] rounded"
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <span className="break-all min-w-0 flex-1 text-[rgb(var(--color-text-700))]">{item.file.name}</span>
                                                <span className="ml-2 flex items-center gap-1 flex-shrink-0 whitespace-nowrap">
                                                    {item.status === 'pending' && (
                                                        <span className="text-[rgb(var(--color-text-400))]">
                                                            {t('documents.uploadSection.pending', 'Pending')}
                                                        </span>
                                                    )}
                                                    {item.status === 'uploading' && (
                                                        <>
                                                            <Spinner size="sm" />
                                                            <span className="text-[rgb(var(--color-text-500))]">
                                                                {t('documents.uploadSection.uploading', 'Uploading...')}
                                                            </span>
                                                        </>
                                                    )}
                                                    {item.status === 'success' && (
                                                        <>
                                                            <Check className="w-4 h-4 text-[rgb(var(--badge-success-text))]" aria-hidden="true" />
                                                            <span className="text-[rgb(var(--badge-success-text))]">
                                                                {t('documents.uploadSection.uploaded', 'Uploaded')}
                                                            </span>
                                                        </>
                                                    )}
                                                    {item.status === 'error' && (
                                                        <>
                                                            <AlertCircle className="w-4 h-4 text-[rgb(var(--color-destructive))]" aria-hidden="true" />
                                                            <span className="text-[rgb(var(--color-destructive))]">
                                                                {t('documents.uploadSection.failed', 'Failed')}
                                                            </span>
                                                        </>
                                                    )}
                                                </span>
                                            </div>
                                            {item.error && (
                                                <p className="text-xs break-words whitespace-pre-wrap text-[rgb(var(--color-destructive))]">
                                                    {item.error}
                                                </p>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {error && (
                            <div className="text-[rgb(var(--color-destructive))] text-sm flex items-center justify-center">
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
                        {t('common.cancel', 'Cancel')}
                    </Button>
                </div>
            </div>
        </ReflectionContainer>

        {/* Folder Selector Modal */}
        <FolderSelectorModal
            isOpen={showFolderModal}
            onClose={() => {
                // Cancellation performs no upload and keeps previous outcomes.
                setShowFolderModal(false);
                setPendingFiles([]);
                // Reset file input so the same file can be re-selected
                resetFileInput();
            }}
            onSelectFolder={handleFolderSelected}
            title={t('documents.folderSelector.defaultTitle', 'Select Destination Folder')}
            description={
                pendingFiles.length > 1
                    ? t('documents.folderSelector.multipleDescription', {
                        count: pendingFiles.length,
                        defaultValue: `Where would you like to save these ${pendingFiles.length} files?`
                    })
                    : pendingFiles.length === 1
                    ? t('documents.folderSelector.singleDescription', {
                        fileName: pendingFiles[0].name,
                        defaultValue: `Where would you like to save "${pendingFiles[0].name}"?`
                    })
                    : t('documents.folderSelector.defaultDescription', 'Choose where to save this document')
            }
            entityId={entityId}
            entityType={entityType}
            getFoldersFn={getFoldersFn}
        />
        </>
    );
}
