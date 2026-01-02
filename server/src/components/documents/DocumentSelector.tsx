'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Search, X, Check, FileText, FileImage, Video, File } from 'lucide-react';
import Spinner from 'server/src/components/ui/Spinner';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import { Input } from 'server/src/components/ui/Input';
import DocumentStorageCard from './DocumentStorageCard';
import { IDocument } from 'server/src/interfaces/document.interface';
import { getAllDocuments, createDocumentAssociations, getDocumentsByFolder } from 'server/src/lib/actions/document-actions/documentActions';
import { Text } from '@radix-ui/themes';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import Pagination from 'server/src/components/ui/Pagination';
import FolderTreeView from './FolderTreeView';
import { useTranslation } from 'server/src/lib/i18n/client';

interface DocumentSelectorProps {
    id: string;
    entityId: string;
    entityType: 'ticket' | 'client' | 'contact' | 'asset' | 'project_task' | 'contract';
    onDocumentSelected?: (document: IDocument) => Promise<void>;
    onDocumentsSelected?: () => Promise<void>;
    singleSelect?: boolean;
    isOpen: boolean;
    onClose: () => void;
    typeFilter?: string; // Optional filter: 'image', 'application/pdf', 'text', etc.
    title?: string; // Optional custom title
    description?: string; // Optional description text
}

export default function DocumentSelector({
    id,
    entityId,
    entityType,
    onDocumentSelected,
    onDocumentsSelected,
    singleSelect = false,
    isOpen,
    onClose,
    typeFilter,
    title,
    description
}: DocumentSelectorProps): React.JSX.Element {
    const [documents, setDocuments] = useState<IDocument[]>([]);
    const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set());
    const [searchTerm, setSearchTerm] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [pageSize, setPageSize] = useState(12);
    const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
    const { t } = useTranslation('common');
    const resolvedTitle = title ?? t('documents.selector.title', 'Select Documents');
    const resolvedDescription = description;

    useEffect(() => {
        if (isOpen) {
            loadDocuments(currentPage);
        }
    }, [isOpen, entityId, entityType, searchTerm, currentPage, selectedFolder]);

    const loadDocuments = async (pageToLoad: number) => {
        try {
            setIsLoading(true);
            setError(null);

            if (!entityId || !entityType) {
                console.error('Missing required props: entityId or entityType is undefined');
                setError(t('documents.selector.errors.configuration', 'Configuration error: Missing entity information'));
                setIsLoading(false);
                return;
            }

            let response;

            // Use getDocumentsByFolder when a folder is selected, otherwise use getAllDocuments
            if (selectedFolder !== null) {
                // Fetch documents in the selected folder
                response = await getDocumentsByFolder(
                    selectedFolder,
                    false, // includeSubfolders
                    pageToLoad,
                    pageSize,
                    {
                        searchTerm: searchTerm,
                        type: typeFilter,
                        excludeEntityId: entityId,
                        excludeEntityType: entityType
                    }
                );
            } else {
                // Fetch all documents (no folder filter)
                response = await getAllDocuments({
                    searchTerm: searchTerm,
                    excludeEntityId: entityId,
                    excludeEntityType: entityType,
                    type: typeFilter
                }, pageToLoad, pageSize);
            }

            if (response && Array.isArray(response.documents)) {
                setDocuments(response.documents);
                setTotalPages(response.totalPages || Math.ceil(response.total / pageSize));
                setCurrentPage(response.currentPage || pageToLoad);
            } else {
                setDocuments([]);
                setTotalPages(1);
                setCurrentPage(1);
                setError(t('documents.selector.errors.invalidData', 'Invalid document data received'));
            }
        } catch (error) {
            console.error('Error loading documents:', error);
            setError(t('documents.selector.errors.load', 'Failed to load documents'));
            setDocuments([]);
            setTotalPages(1);
            setCurrentPage(1);
        } finally {
            setIsLoading(false);
        }
    };
    
    const handlePageChange = (newPage: number) => {
        setCurrentPage(newPage);
    };

    // Handle search input changes
    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(e.target.value);
    };

    // Perform search when Enter is pressed
    const handleSearchKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            setCurrentPage(1);
            loadDocuments(1);
        }
    };

    // Toggle document selection
    const toggleDocumentSelection = (documentId: string) => {
        const newSelection = new Set(selectedDocuments);
        if (newSelection.has(documentId)) {
            newSelection.delete(documentId);
        } else {
            if (singleSelect) {
                newSelection.clear();
            }
            newSelection.add(documentId);
        }
        setSelectedDocuments(newSelection);
    };

    // Save selected documents
    const handleSave = async () => {
        try {
            setIsSaving(true);
            setError(null);

            const selectedIds = Array.from(selectedDocuments);
            if (selectedIds.length === 0) return;

            // Validate required props before using them
            if (!entityId || !entityType) {
                console.error('Missing required props: entityId or entityType is undefined');
                setError(t('documents.selector.errors.configuration', 'Configuration error: Missing entity information'));
                setIsSaving(false);
                return;
            }

            if (singleSelect && onDocumentSelected) {
                const selectedDoc = documents.find(d => d.document_id === selectedIds[0]);
                if (selectedDoc) {
                    await onDocumentSelected(selectedDoc);
                }
            } else if (onDocumentsSelected) {
                // Create associations for selected documents
                await createDocumentAssociations(
                    entityId,
                    entityType,
                    selectedIds
                );
                await onDocumentsSelected();
            }

            onClose();
        } catch (error) {
            console.error('Error saving document selection:', error);
            setError(t('documents.selector.errors.save', 'Failed to save document selection'));
        } finally {
            setIsSaving(false);
        }
    };

    // Early validation of required props
    if (!id || !entityId || !entityType) {
        console.error('DocumentSelector: Missing required props', { id, entityId, entityType });
        return (
            <Dialog 
              isOpen={isOpen} 
              onClose={onClose} 
              data-testid="document-selector-dialog" 
              title={t('documents.selector.configErrorTitle', 'Configuration Error')}
            >
                <DialogContent>
                    <div className="p-4 text-red-500">
                        {t('documents.selector.configErrorMessage', 'Missing required configuration. Please contact support.')}
                    </div>
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <Dialog
          isOpen={isOpen}
          onClose={onClose}
          title={resolvedTitle}
        >
            <DialogContent>
                <ReflectionContainer
                    id={id}
                    label={t('documents.selector.reflectionLabel', 'Document Selector')}
                >
                    <div className="space-y-4">
                        {/* Description */}
                        {description && (
                            <Text as="p" size="2" className="text-gray-600">
                                {description}
                            </Text>
                        )}

                        {/* Search Bar */}
                        <div className="relative">
                            <Input
                                id={`${id}-search`}
                                type="text"
                                placeholder={t('documents.selector.searchPlaceholder', 'Search documents...')}
                                value={searchTerm}
                                onChange={handleSearchChange}
                                onKeyPress={handleSearchKeyPress}
                                className="pl-10"
                            />
                            <Search className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
                        </div>

                        {/* Error Message */}
                        {error && (
                            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded flex items-center">
                                <X className="w-4 h-4 mr-2" />
                                {error}
                            </div>
                        )}

                        {/* Two-pane layout: Folders + Documents */}
                        <div className="flex gap-4">
                            {/* Folder Navigation Sidebar */}
                            <div className="w-64 flex-shrink-0 border-r border-gray-200 pr-4">
                                <div className="text-sm font-medium text-gray-700 mb-2">
                                    {t('documents.selector.foldersLabel', 'Folders')}
                                </div>
                                <FolderTreeView
                                    selectedFolder={selectedFolder}
                                    onFolderSelect={(folder) => {
                                        setSelectedFolder(folder);
                                        setCurrentPage(1);
                                    }}
                                />
                            </div>

                            {/* Documents Grid */}
                            <div className="flex-1">
                                {isLoading ? (
                                    <div className="flex justify-center py-8">
                                        <Spinner size="sm" />
                                    </div>
                                ) : (
                                    <>
                                        {/* Unified Compact Grid for all document types */}
                                        <div className="grid grid-cols-3 md:grid-cols-4 gap-3 max-h-[60vh] overflow-y-auto p-2">
                                            {documents.map((document): React.JSX.Element => {
                                                const isImage = document.mime_type?.startsWith('image/');
                                                const isVideo = document.mime_type?.startsWith('video/');
                                                const isPdf = document.mime_type === 'application/pdf';

                                                return (
                                                    <div
                                                        key={document.document_id}
                                                        id={`${id}-document-${document.document_id}`}
                                                        className={`relative cursor-pointer rounded-lg border-2 overflow-hidden transition-all aspect-square ${
                                                            selectedDocuments.has(document.document_id)
                                                                ? 'border-primary-500 ring-2 ring-primary-500'
                                                                : 'border-gray-200 hover:border-primary-300'
                                                        }`}
                                                        onClick={() => toggleDocumentSelection(document.document_id)}
                                                    >
                                                        {/* Document Preview/Icon */}
                                                        {isImage && (document.thumbnail_file_id || document.file_id) ? (
                                                            <img
                                                                src={document.thumbnail_file_id
                                                                    ? `/api/documents/${document.document_id}/thumbnail`
                                                                    : `/api/documents/view/${document.file_id}`
                                                                }
                                                                alt={document.document_name}
                                                                className="w-full h-full object-cover"
                                                                onError={(e) => {
                                                                    if (document.file_id && e.currentTarget.src.includes('thumbnail')) {
                                                                        e.currentTarget.src = `/api/documents/view/${document.file_id}`;
                                                                    }
                                                                }}
                                                            />
                                                        ) : isVideo && document.thumbnail_file_id ? (
                                                            <div className="relative w-full h-full">
                                                                <img
                                                                    src={`/api/documents/${document.document_id}/thumbnail`}
                                                                    alt={document.document_name}
                                                                    className="w-full h-full object-cover"
                                                                />
                                                                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                                                                    <Video className="w-12 h-12 text-white opacity-80" />
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50">
                                                                {isVideo ? (
                                                                    <Video className="w-12 h-12 text-gray-400 mb-2" />
                                                                ) : isPdf ? (
                                                                    <FileText className="w-12 h-12 text-red-400 mb-2" />
                                                                ) : (
                                                                    <File className="w-12 h-12 text-gray-400 mb-2" />
                                                                )}
                                                                <Text as="p" size="1" className="text-gray-500 text-center px-2">
                                                                    {document.mime_type?.split('/')[1]?.toUpperCase() || 'FILE'}
                                                                </Text>
                                                            </div>
                                                        )}

                                                        {/* Selected Indicator */}
                                                        {selectedDocuments.has(document.document_id) && (
                                                            <div className="absolute top-2 right-2 bg-primary-500 text-white rounded-full p-1.5 shadow-lg">
                                                                <Check className="w-4 h-4" />
                                                            </div>
                                                        )}

                                                        {/* Document Name Overlay */}
                                                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 via-black/50 to-transparent p-2 pt-8">
                                                            <Text
                                                                as="p"
                                                                size="1"
                                                                className="text-white font-medium truncate"
                                                                title={document.document_name}
                                                            >
                                                                {document.document_name}
                                                            </Text>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                            {documents.length === 0 && !isLoading && (
                                                <div className="col-span-full text-center py-8">
                                                    <File className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                                                    <Text as="div" size="2" color="gray">
                                                        {t('documents.empty.default', 'No documents found')}
                                                    </Text>
                                                    {selectedFolder && (
                                                        <Text as="div" size="1" color="gray" className="mt-1">
                                                            {t('documents.selector.folderHint', {
                                                                folder: selectedFolder,
                                                                defaultValue: `in folder "${selectedFolder}"`
                                                            })}
                                                        </Text>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                
                                        {/* Pagination */}
                                        <Pagination
                                            id={`${id}-pagination`}
                                            currentPage={currentPage}
                                            totalItems={totalPages * pageSize}
                                            itemsPerPage={pageSize}
                                            onPageChange={handlePageChange}
                                            variant="full"
                                            className={totalPages <= 1 ? 'hidden' : ''}
                                        />
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="pt-4 border-t mt-4">
                            {/* Loading State */}
                            {isSaving && (
                                <div className="flex justify-center mb-3">
                                    <LoadingIndicator
                                        text={t('documents.selector.saving', 'Saving...')}
                                        spinnerProps={{ size: 'sm' }}
                                    />
                                </div>
                            )}

                            <div className="flex justify-end space-x-2">
                                <Button
                                    id="cancel-document-selection-button"
                                    variant="outline"
                                    onClick={onClose}
                                    disabled={isSaving}
                                >
                                    {t('common.cancel', 'Cancel')}
                                </Button>
                                <Button
                                    id="save-document-selection-button"
                                    onClick={handleSave}
                                    disabled={selectedDocuments.size === 0 || isSaving}
                                >
                                    {singleSelect
                                        ? t('documents.selector.selectDocument', 'Select Document')
                                        : t('documents.selector.associateSelected', 'Associate Selected')}
                                </Button>
                            </div>
                        </div>
                    </div>
                </ReflectionContainer>
            </DialogContent>
        </Dialog>
    );
}
