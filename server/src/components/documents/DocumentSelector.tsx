'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Search, X, Check } from 'lucide-react';
import Spinner from 'server/src/components/ui/Spinner';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import { Input } from 'server/src/components/ui/Input';
import DocumentStorageCard from './DocumentStorageCard';
import { IDocument } from 'server/src/interfaces/document.interface';
import { getAllDocuments, createDocumentAssociations } from 'server/src/lib/actions/document-actions/documentActions';
import { Text } from '@radix-ui/themes';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import Pagination from 'server/src/components/ui/Pagination';

interface DocumentSelectorProps {
    id: string;
    entityId: string;
    entityType: 'ticket' | 'client' | 'contact' | 'asset' | 'project_task';
    onDocumentSelected?: (document: IDocument) => Promise<void>;
    onDocumentsSelected?: () => Promise<void>;
    singleSelect?: boolean;
    isOpen: boolean;
    onClose: () => void;
}

export default function DocumentSelector({
    id,
    entityId,
    entityType,
    onDocumentSelected,
    onDocumentsSelected,
    singleSelect = false,
    isOpen,
    onClose
}: DocumentSelectorProps): JSX.Element {
    const [documents, setDocuments] = useState<IDocument[]>([]);
    const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set());
    const [searchTerm, setSearchTerm] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    useEffect(() => {
        if (isOpen) {
            loadDocuments(currentPage);
        }
    }, [isOpen, entityId, entityType, searchTerm, currentPage]);

    const loadDocuments = async (pageToLoad: number) => {
        try {
            setIsLoading(true);
            setError(null);
            
            if (!entityId || !entityType) {
                console.error('Missing required props: entityId or entityType is undefined');
                setError('Configuration error: Missing entity information');
                setIsLoading(false);
                return;
            }
            
            const response = await getAllDocuments({
                searchTerm: searchTerm,
                excludeEntityId: entityId,
                excludeEntityType: entityType
            }, pageToLoad, pageSize);

            if (response && Array.isArray(response.documents)) {
                setDocuments(response.documents);
                setTotalPages(response.totalPages);
                setCurrentPage(response.currentPage);
            } else {
                setDocuments([]);
                setTotalPages(1);
                setCurrentPage(1);
                setError('Invalid document data received');
            }
        } catch (error) {
            console.error('Error loading documents:', error);
            setError('Failed to load documents');
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
                setError('Configuration error: Missing entity information');
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
            setError('Failed to save document selection');
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
              title="Configuration Error"
            >
                <DialogContent>
                    <div className="p-4 text-red-500">
                        Missing required configuration. Please contact support.
                    </div>
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <Dialog 
          isOpen={isOpen} 
          onClose={onClose} 
          title="Select Documents"
        >
            <DialogContent>
                <ReflectionContainer id={id} label="Document Selector">
                    <div className="space-y-4">
                        {/* Search Bar */}
                        <div className="relative">
                            <Input
                                id={`${id}-search`}
                                type="text"
                                placeholder="Search documents..."
                                value={searchTerm}
                                onChange={handleSearchChange}
                                onKeyPress={handleSearchKeyPress}
                                className="pl-10"
                            />
                            <Search className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
                        </div>

                        {/* Error Message */}
                        {error && (
                            <Text as="div" size="2" color="red" className="flex items-center">
                                <X className="w-4 h-4 mr-2" />
                                {error}
                            </Text>
                        )}

                        {/* Loading State */}
                        {isLoading ? (
                            <div className="flex justify-center py-8">
                                <Spinner size="sm" />
                            </div>
                        ) : (
                            <>
                                {/* Documents Grid */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto p-2">
                                    {documents.map((document): JSX.Element => (
                                        <div
                                            key={document.document_id}
                                            id={`${id}-document-${document.document_id}`}
                                            className={`relative cursor-pointer transition-all ${
                                                selectedDocuments.has(document.document_id)
                                                    ? 'ring-2 ring-primary-500'
                                                    : 'hover:ring-2 hover:ring-gray-200'
                                            }`}
                                            onClick={() => toggleDocumentSelection(document.document_id)}
                                        >
                                            <DocumentStorageCard
                                                id={`${id}-document-card-${document.document_id}`}
                                                document={document}
                                                hideActions
                                            />
                                            {selectedDocuments.has(document.document_id) && (
                                                <div className="absolute top-2 right-2 bg-primary-500 text-white rounded-full p-1">
                                                    <Check className="w-4 h-4" />
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                    {documents.length === 0 && !isLoading && (
                                        <div className="col-span-full text-center py-8">
                                            <Text as="div" size="2" color="gray">
                                                No documents found
                                            </Text>
                                        </div>
                                    )}
                                </div>
                                
                                {/* Standardized Pagination for Document Selector */}
                                <Pagination
                                    id={`${id}-pagination`}
                                    currentPage={currentPage}
                                    totalItems={totalPages * pageSize}
                                    itemsPerPage={pageSize}
                                    onPageChange={handlePageChange}
                                    variant="full"
                                    className={totalPages <= 1 ? 'hidden' : ''}
                                />

                                {/* Action Buttons */}
                                <div className="flex justify-end space-x-2 pt-4 border-t mt-4">
                                    <Button
                                        id="cancel-document-selection-button"
                                        variant="outline"
                                        onClick={onClose}
                                        disabled={isSaving}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        id="save-document-selection-button"
                                        onClick={handleSave}
                                        disabled={selectedDocuments.size === 0 || isSaving}
                                    >
                                        {isSaving ? (
                                            <>
                                                <LoadingIndicator text="Saving..." spinnerProps={{ size: "sm" }} />
                                            </>
                                        ) : (
                                            singleSelect ? 'Select Document' : 'Associate Selected'
                                        )}
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                </ReflectionContainer>
            </DialogContent>
        </Dialog>
    );
}
