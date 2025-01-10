'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Search, X, Check, Loader2 } from 'lucide-react';
import { Input } from '../ui/Input';
import DocumentStorageCard from './DocumentStorageCard';
import { IDocument } from '../../interfaces/document.interface';
import { getAllDocuments, createDocumentAssociations } from '../../lib/actions/document-actions/documentActions';
import { Text } from '@radix-ui/themes';
import { useAutomationIdAndRegister } from '../../types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';
import { ContainerComponent, FormFieldComponent, ButtonComponent } from '../../types/ui-reflection/types';

interface DocumentSelectorProps {
    id: string; // Made required since it's needed for reflection registration
    entityId: string;
    entityType: 'ticket' | 'company' | 'contact' | 'schedule' | 'asset';
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

    // Load documents when dialog opens
    useEffect(() => {
        if (isOpen) {
            loadDocuments();
        }
    }, [isOpen]);

    const loadDocuments = async () => {
        try {
            setIsLoading(true);
            setError(null);
            const docs = await getAllDocuments({
                searchTerm: searchTerm,
                excludeEntityId: entityId,
                excludeEntityType: entityType
            });
            setDocuments(docs);
        } catch (error) {
            console.error('Error loading documents:', error);
            setError('Failed to load documents');
        } finally {
            setIsLoading(false);
        }
    };

    // Handle search input changes
    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(e.target.value);
    };

    // Perform search when Enter is pressed
    const handleSearchKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            loadDocuments();
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

    return (
        <Dialog isOpen={isOpen} onClose={onClose}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Select Documents</DialogTitle>
                </DialogHeader>
                <ReflectionContainer id={id} label="Document Selector">
                    <div className="space-y-4">
                        {/* Search Bar */}
                        <div className="relative">
                            <Input
                                {...useAutomationIdAndRegister<FormFieldComponent>({
                                    id: `${id}-search`,
                                    type: 'formField',
                                    fieldType: 'textField',
                                    label: 'Search Documents',
                                    value: searchTerm
                                }).automationIdProps}
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
                            <Text {...useAutomationIdAndRegister<ContainerComponent>({
                                id: `${id}-error`,
                                type: 'container',
                                label: 'Error Message'
                            }).automationIdProps} as="div" size="2" color="red" className="flex items-center">
                                <X className="w-4 h-4 mr-2" />
                                {error}
                            </Text>
                        )}

                        {/* Loading State */}
                        {isLoading ? (
                            <div {...useAutomationIdAndRegister<ContainerComponent>({
                                id: `${id}-loading`,
                                type: 'container',
                                label: 'Loading'
                            }).automationIdProps} className="flex justify-center py-8">
                                <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
                            </div>
                        ) : (
                            <>
                                {/* Documents Grid */}
                                <div {...useAutomationIdAndRegister<ContainerComponent>({
                                    id: `${id}-grid`,
                                    type: 'container',
                                    label: 'Documents Grid'
                                }).automationIdProps} className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto p-2">
                                    {documents.map((document): JSX.Element => (
                                        <div
                                            key={document.document_id}
                                            {...useAutomationIdAndRegister<ContainerComponent>({
                                                id: `${id}-document-${document.document_id}`,
                                                type: 'container',
                                                label: `Document ${document.document_name}`
                                            }).automationIdProps}
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
                                            {/* Selection Indicator */}
                                            {selectedDocuments.has(document.document_id) && (
                                                <div className="absolute top-2 right-2 bg-primary-500 text-white rounded-full p-1">
                                                    <Check className="w-4 h-4" />
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                    {documents.length === 0 && !isLoading && (
                                        <div {...useAutomationIdAndRegister<ContainerComponent>({
                                            id: `${id}-empty`,
                                            type: 'container',
                                            label: 'No Documents'
                                        }).automationIdProps} className="col-span-2 text-center py-8">
                                            <Text as="div" size="2" color="gray">
                                                No documents found
                                            </Text>
                                        </div>
                                    )}
                                </div>

                                {/* Action Buttons */}
                                <div className="flex justify-end space-x-2 pt-4 border-t">
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
                                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                Saving...
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
