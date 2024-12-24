"use client";

import { useState, useEffect, useRef } from 'react';
import { Block, BlockNoteEditor } from '@blocknote/core';
import { IDocument } from '@/interfaces/document.interface';
import DocumentStorageCard from './DocumentStorageCard';
import DocumentUpload from './DocumentUpload';
import DocumentSelector from './DocumentSelector';
import DocumentsPagination from './DocumentsPagination';
import { Button } from '@/components/ui/Button';
import Drawer from '@/components/ui/Drawer';
import { Input } from '@/components/ui/Input';
import TextEditor from '@/components/editor/TextEditor';
import { 
    getDocumentsByEntity, 
    deleteDocument, 
    removeDocumentAssociations,
    updateDocument
} from '@/lib/actions/document-actions/documentActions';
import { 
    getBlockContent,
    createBlockDocument,
    updateBlockContent 
} from '@/lib/actions/document-actions/documentBlockContentActions';
import { Plus, Link, FileText } from 'lucide-react';

interface DocumentsProps {
    documents: IDocument[];
    gridColumns?: 3 | 4;
    userId: string;
    entityId?: string;
    entityType?: 'ticket' | 'company' | 'contact' | 'schedule' | 'asset';
    isLoading?: boolean;
    onDocumentCreated?: () => Promise<void>;
}

const Documents = ({
    documents: initialDocuments,
    gridColumns,
    userId,
    entityId,
    entityType,
    isLoading = false,
    onDocumentCreated
}: DocumentsProps): JSX.Element => {
    const [documents, setDocuments] = useState<IDocument[]>(initialDocuments);
    const [showUpload, setShowUpload] = useState(false);
    const [showSelector, setShowSelector] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedDocument, setSelectedDocument] = useState<IDocument | null>(null);
    const [documentContent, setDocumentContent] = useState<any>(null);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [isCreatingNew, setIsCreatingNew] = useState(false);
    const [newDocumentName, setNewDocumentName] = useState('');
    const [documentName, setDocumentName] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [currentContent, setCurrentContent] = useState<Block[]>([]);
    const [hasContentChanged, setHasContentChanged] = useState(false);
    const editorRef = useRef<BlockNoteEditor | null>(null);

    // Format blocks for database storage
    const formatBlocksForStorage = (blocks: Block[]) => {
        return {
            blocks,
            version: 1,
            time: new Date().toISOString()
        };
    };

    // Parse block data from storage
    const parseBlockData = (blockData: any) => {
        try {
            if (typeof blockData === 'string') {
                const parsed = JSON.parse(blockData);
                return parsed.blocks || parsed;
            }
            return blockData.blocks || blockData;
        } catch (error) {
            console.error('Error parsing block data:', error);
            return [];
        }
    };

    // Handle document click for content viewing
    const handleDocumentClick = async (document: IDocument) => {
        try {
            // Only handle documents without file_id (content documents)
            if (!document.file_id) {
                setSelectedDocument(document);
                const content = await getBlockContent(document.document_id);
                setDocumentContent(content);
                setDocumentName(document.document_name);
                setIsDrawerOpen(true);
                setHasContentChanged(false);
            }
        } catch (error) {
            console.error('Error fetching document content:', error);
            setError('Failed to load document content');
        }
    };

    // Handle creating a new document
    const handleCreateDocument = async () => {
        setIsCreatingNew(true);
        setNewDocumentName('');
        setDocumentContent(null);
        setSelectedDocument(null);
        setIsDrawerOpen(true);
    };

    // Handle saving a new document
    const handleSaveNewDocument = async () => {
        try {
            if (!newDocumentName.trim()) {
                setError('Document name is required');
                return;
            }

            setIsSaving(true);
            const formattedContent = formatBlocksForStorage(currentContent);
            const result = await createBlockDocument({
                document_name: newDocumentName,
                user_id: userId,
                block_data: formattedContent,
                entityId,
                entityType
            });

            // Refresh documents list
            if (entityId && entityType) {
                const updatedDocuments = await getDocumentsByEntity(entityId, entityType);
                setDocuments(updatedDocuments);
            }

            if (onDocumentCreated) {
                await onDocumentCreated();
            }

            setIsCreatingNew(false);
            setIsDrawerOpen(false);
        } catch (error) {
            console.error('Error creating document:', error);
            setError('Failed to create document');
        } finally {
            setIsSaving(false);
        }
    };

    // Handle saving document changes
    const handleSaveChanges = async () => {
        try {
            if (!selectedDocument) return;

            setIsSaving(true);
            // Update document name if changed
            if (documentName !== selectedDocument.document_name) {
                await updateDocument(selectedDocument.document_id, {
                    document_name: documentName
                });

                // Update selected document with new name
                setSelectedDocument({
                    ...selectedDocument,
                    document_name: documentName
                });

                // Refresh documents list to show updated name
                if (entityId && entityType) {
                    const updatedDocuments = await getDocumentsByEntity(entityId, entityType);
                    setDocuments(updatedDocuments);
                }

                // Notify parent of changes
                if (onDocumentCreated) {
                    await onDocumentCreated();
                }
            }

            // Only update content if it has changed
            if (hasContentChanged) {
                const formattedContent = formatBlocksForStorage(currentContent);
                await updateBlockContent(selectedDocument.document_id, {
                    block_data: formattedContent,
                    user_id: userId
                });

                // Refresh content
                const updatedContent = await getBlockContent(selectedDocument.document_id);
                setDocumentContent(updatedContent);
                setHasContentChanged(false);

                // Refresh documents list to show updated timestamp
                if (entityId && entityType) {
                    const updatedDocuments = await getDocumentsByEntity(entityId, entityType);
                    setDocuments(updatedDocuments);
                }

                // Notify parent of changes
                if (onDocumentCreated) {
                    await onDocumentCreated();
                }
            }
        } catch (error) {
            console.error('Error saving document:', error);
            setError('Failed to save document');
        } finally {
            setIsSaving(false);
        }
    };

    // Update documents when initialDocuments changes
    useEffect(() => {
        if (Array.isArray(initialDocuments)) {
            setDocuments(initialDocuments);
            setError(null);
        } else {
            console.error('initialDocuments is not an array:', initialDocuments);
            setDocuments([]);
            setError('Invalid document data');
        }
    }, [initialDocuments]);

    // Set grid columns based on the number of columns
    const gridColumnsClass = gridColumns === 4
        ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
        : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

    // Handle file upload completion
    const handleUploadComplete = async (uploadResult: { success: boolean; document: IDocument }) => {
        setShowUpload(false);
        if (uploadResult.success) {
            setDocuments(prev => [uploadResult.document, ...prev]);
            if (onDocumentCreated) {
                await onDocumentCreated();
            }
        }
    };

    // Handle document selection completion
    const handleDocumentsSelected = async () => {
        try {
            if (entityId && entityType) {
                const updatedDocuments = await getDocumentsByEntity(entityId, entityType);
                setDocuments(updatedDocuments);
            }
            if (onDocumentCreated) {
                await onDocumentCreated();
            }
        } catch (error) {
            console.error('Error refreshing documents:', error);
            setError('Failed to refresh documents');
        }
    };

    // Handle document deletion
    const handleDelete = async (document: IDocument) => {
        try {
            await deleteDocument(document.document_id, userId);
            setDocuments(prev => prev.filter(d => d.document_id !== document.document_id));
            if (onDocumentCreated) {
                await onDocumentCreated();
            }
        } catch (error) {
            console.error('Error deleting document:', error);
            setError('Failed to delete document');
        }
    };

    // Handle document disassociation
    const handleDisassociate = async (document: IDocument) => {
        if (!entityId || !entityType) return;

        try {
            await removeDocumentAssociations(entityId, entityType, [document.document_id]);
            setDocuments(prev => prev.filter(d => d.document_id !== document.document_id));
            if (onDocumentCreated) {
                await onDocumentCreated();
            }
        } catch (error) {
            console.error('Error disassociating document:', error);
            setError('Failed to remove document association');
        }
    };

    return (
        <div className="w-full space-y-4">
            <div className="flex justify-between items-center">
                <div className="flex space-x-2">
                    {/* Create new document button */}
                    <Button
                        onClick={handleCreateDocument}
                        className="bg-[#6941C6] text-white hover:bg-[#5B34B5]"
                    >
                        <FileText className="w-4 h-4 mr-2" />
                        New Document
                    </Button>
                    {/* Upload new document button */}
                    <Button
                        onClick={() => setShowUpload(true)}
                        className="bg-[#6941C6] text-white hover:bg-[#5B34B5]"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        Upload File
                    </Button>
                    {/* Select existing documents button - only show if entityId and entityType are provided */}
                    {entityId && entityType && (
                        <Button
                            onClick={() => setShowSelector(true)}
                            className="bg-[#6941C6] text-white hover:bg-[#5B34B5]"
                        >
                            <Link className="w-4 h-4 mr-2" />
                            Link Documents
                        </Button>
                    )}
                </div>
            </div>

            {/* Upload Dialog */}
            {showUpload && (
                <div className="mb-4 p-4 border border-gray-200 rounded-md bg-white">
                    <DocumentUpload
                        userId={userId}
                        entityId={entityId}
                        entityType={entityType}
                        onUploadComplete={handleUploadComplete}
                        onCancel={() => setShowUpload(false)}
                    />
                </div>
            )}

            {/* Document Selector Dialog - only render if entityId and entityType are provided */}
            {entityId && entityType && (
                <DocumentSelector
                    entityId={entityId}
                    entityType={entityType}
                    onDocumentsSelected={handleDocumentsSelected}
                    isOpen={showSelector}
                    onClose={() => setShowSelector(false)}
                />
            )}

            {/* Error State */}
            {error && (
                <div className="text-center py-4 text-red-500 bg-red-50 rounded-md">
                    {error}
                </div>
            )}

            {/* Loading State */}
            {isLoading && (
                <div className="flex justify-center items-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#6941C6]"></div>
                </div>
            )}

            {/* Documents Grid */}
            {!isLoading && documents && documents.length > 0 ? (
                <div className={`grid ${gridColumnsClass} gap-4`}>
                    {documents.map((document): JSX.Element => (
                        <div key={document.document_id} className="h-full">
                            <DocumentStorageCard
                                document={document}
                                onDelete={() => handleDelete(document)}
                                onDisassociate={entityId && entityType ? () => handleDisassociate(document) : undefined}
                                showDisassociate={Boolean(entityId && entityType)}
                                onClick={() => handleDocumentClick(document)}
                                isContentDocument={!document.file_id}
                            />
                        </div>
                    ))}
                </div>
            ) : !isLoading && (
                <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-md">
                    No documents found
                </div>
            )}

            {/* Pagination */}
            {documents && documents.length > 0 && (
                <div className="mt-4">
                    <DocumentsPagination />
                </div>
            )}

            {/* Content Drawer */}
            <Drawer
                isOpen={isDrawerOpen}
                onClose={() => {
                    setIsDrawerOpen(false);
                    setSelectedDocument(null);
                    setDocumentContent(null);
                    setIsCreatingNew(false);
                    setHasContentChanged(false);
                }}
            >
                <div className="p-6">
                    {isCreatingNew ? (
                        <div className="space-y-4">
                            <Input
                                type="text"
                                placeholder="Document Name"
                                value={newDocumentName}
                                onChange={(e) => setNewDocumentName(e.target.value)}
                            />
                            <div className="flex justify-end space-x-2 mb-4">
                                <Button
                                    onClick={() => {
                                        setIsDrawerOpen(false);
                                        setIsCreatingNew(false);
                                    }}
                                    variant="outline"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onClick={handleSaveNewDocument}
                                    disabled={isSaving}
                                    className="bg-[#6941C6] text-white hover:bg-[#5B34B5]"
                                >
                                    {isSaving ? 'Saving...' : 'Save'}
                                </Button>
                            </div>
                            <TextEditor
                                editorRef={editorRef}
                                initialContent={[]}
                                onContentChange={(blocks) => {
                                    setCurrentContent(blocks);
                                    setHasContentChanged(true);
                                }}
                            />
                        </div>
                    ) : selectedDocument && (
                        <div className="space-y-4">
                            <div>
                                <div className="flex justify-end mb-4">
                                    <Button
                                        onClick={handleSaveChanges}
                                        disabled={isSaving}
                                        className="bg-[#6941C6] text-white hover:bg-[#5B34B5]"
                                    >
                                        {isSaving ? 'Saving...' : 'Save'}
                                    </Button>
                                </div>
                                <Input
                                    type="text"
                                    value={documentName}
                                    onChange={(e) => setDocumentName(e.target.value)}
                                    className="text-lg font-semibold mb-2"
                                />
                                <TextEditor
                                    editorRef={editorRef}
                                    initialContent={documentContent ? parseBlockData(documentContent.block_data) : []}
                                    onContentChange={(blocks) => {
                                        setCurrentContent(blocks);
                                        setHasContentChanged(true);
                                    }}
                                />
                            </div>
                        </div>
                    )}
                </div>
            </Drawer>
        </div>
    );
};

export default Documents;
