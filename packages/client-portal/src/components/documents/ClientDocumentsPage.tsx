'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Button } from '@alga-psa/ui/components/Button';
import { CollapseToggleButton } from '@alga-psa/ui/components/CollapseToggleButton';
import { Input } from '@alga-psa/ui/components/Input';
import Spinner from '@alga-psa/ui/components/Spinner';
import { Search, ChevronRight, ChevronDown, Download, FileText, Image, File, Video, ChevronUp, FolderOpen } from 'lucide-react';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import type { IDocument, IFolderNode } from '@alga-psa/types';
import { getClientDocuments, getClientDocumentFolders, downloadClientDocument, ClientDocumentFilters, PaginatedClientDocuments } from '@alga-psa/client-portal/actions/client-portal-actions/client-documents';
import { useDocumentsCrossFeature } from '@alga-psa/core/context/DocumentsCrossFeatureContext';

function getDocumentIcon(mimeType: string | undefined): React.ReactNode {
  if (!mimeType) return <File className="w-5 h-5" />;

  if (mimeType.startsWith('image/')) {
    return <Image className="w-5 h-5 text-green-500" />;
  }
  if (mimeType.startsWith('video/')) {
    return <Video className="w-5 h-5 text-purple-500" />;
  }
  if (mimeType === 'application/pdf') {
    return <FileText className="w-5 h-5 text-red-500" />;
  }
  if (mimeType.includes('word') || mimeType.includes('document')) {
    return <FileText className="w-5 h-5 text-blue-500" />;
  }
  if (mimeType.includes('sheet') || mimeType.includes('excel')) {
    return <FileText className="w-5 h-5 text-green-600" />;
  }

  return <File className="w-5 h-5 text-gray-500" />;
}

function formatFileSize(bytes: number | undefined): string {
  if (!bytes) return '--';

  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let size = bytes;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function formatDate(dateString: string | Date | undefined): string {
  if (!dateString) return '--';
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

interface FolderTreeNodeProps {
  node: IFolderNode;
  selectedPath: string | null;
  onSelect: (path: string | null) => void;
  level?: number;
}

function FolderTreeNode({ node, selectedPath, onSelect, level = 0 }: FolderTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedPath === node.path;

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1.5 px-2 cursor-pointer rounded transition-colors ${
          isSelected
            ? 'bg-primary/10 text-primary'
            : 'hover:bg-muted'
        }`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={() => onSelect(node.path)}
      >
        {hasChildren && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="p-0.5 hover:bg-muted rounded"
          >
            {isExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </button>
        )}
        {!hasChildren && <span className="w-4" />}
        <FolderOpen className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm truncate">{node.name}</span>
      </div>
      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <FolderTreeNode
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onSelect={onSelect}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface DocumentCardProps {
  document: IDocument;
  onDownload: (doc: IDocument) => void;
  isDownloading: boolean;
}

function DocumentCard({ document, onDownload, isDownloading }: DocumentCardProps) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 p-2 bg-muted rounded-lg">
            {getDocumentIcon(document.mime_type)}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-medium truncate">{document.document_name}</h4>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              <span>{formatFileSize(document.file_size)}</span>
              <span>·</span>
              <span>{formatDate(document.entered_at)}</span>
            </div>
          </div>
          <Button
            id="client-docs-download-document"
            variant="ghost"
            size="sm"
            onClick={() => onDownload(document)}
            disabled={isDownloading}
            className="flex-shrink-0"
          >
            <Download className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ClientDocumentsPage() {
  const { downloadDocument, getDocumentDownloadUrl } = useDocumentsCrossFeature();
  const { t } = useTranslation('features/documents');

  const [documents, setDocuments] = useState<IDocument[]>([]);
  const [folders, setFolders] = useState<IFolderNode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [isFolderSidebarCollapsed, setIsFolderSidebarCollapsed] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const pageSize = 20;

  const loadDocuments = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const filters: ClientDocumentFilters = {};
      if (searchTerm) {
        filters.search = searchTerm;
      }
      if (selectedFolder) {
        filters.folderPath = selectedFolder;
      }

      const result = await getClientDocuments(page, pageSize, filters);
      setDocuments(result.documents);
      setTotalPages(result.totalPages);
      setTotal(result.total);
    } catch (error) {
      console.error('Failed to load documents:', error);
      setLoadError(t('portal.loadError', 'Failed to load documents. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  }, [page, pageSize, searchTerm, selectedFolder, t]);

  const loadFolders = useCallback(async () => {
    try {
      const result = await getClientDocumentFolders();
      setFolders(result);
    } catch (error) {
      console.error('Failed to load folders:', error);
    }
  }, []);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const handleSearch = useCallback((value: string) => {
    setSearchTerm(value);
    setPage(1);
  }, []);

  const handleFolderSelect = useCallback((path: string | null) => {
    setSelectedFolder(path === selectedFolder ? null : path);
    setPage(1);
  }, [selectedFolder]);

  const handleDownload = useCallback(async (doc: IDocument) => {
    try {
      setDownloadingId(doc.document_id);
      // Verify access before downloading
      await downloadClientDocument(doc.document_id);
      // Use the standard download utility
      await downloadDocument(await getDocumentDownloadUrl(doc.file_id || ''), doc.document_name);
    } catch (error) {
      console.error('Failed to download document:', error);
    } finally {
      setDownloadingId(null);
    }
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{t('title', 'Documents')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('portal.subtitle', 'View and download your shared documents')}
          </p>
        </div>
      </div>

      <div className="flex flex-1 gap-4 min-h-0">
        {/* Folder Sidebar */}
        {folders.length > 0 && (
          <div className={`flex-shrink-0 transition-all ${isFolderSidebarCollapsed ? 'w-10' : 'w-64'}`}>
            <Card className="h-full">
              <CardContent className="p-2 h-full overflow-auto">
                {isFolderSidebarCollapsed ? (
                  <CollapseToggleButton
                    id="client-docs-expand-sidebar"
                    isCollapsed={true}
                    collapsedLabel="Show folders"
                    expandedLabel="Collapse folders"
                    expandDirection="right"
                    onClick={() => setIsFolderSidebarCollapsed(false)}
                    className="mx-auto"
                  />
                ) : (
                  <>
                    <div className="flex items-center justify-between px-2 py-1 mb-2">
                      <span className="text-sm font-medium">{t('folders.title', 'Folders')}</span>
                      <CollapseToggleButton
                        id="client-docs-collapse-sidebar"
                        isCollapsed={false}
                        collapsedLabel="Show folders"
                        expandedLabel="Collapse folders"
                        expandDirection="right"
                        onClick={() => setIsFolderSidebarCollapsed(true)}
                      />
                    </div>
                    <div
                      className={`py-1.5 px-2 cursor-pointer rounded transition-colors ${
                        selectedFolder === null
                          ? 'bg-primary/10 text-primary'
                          : 'hover:bg-muted'
                      }`}
                      onClick={() => handleFolderSelect(null)}
                    >
                      <span className="text-sm">{t('folders.allDocuments', 'All Documents')}</span>
                    </div>
                    {folders.map((folder) => (
                      <FolderTreeNode
                        key={folder.path}
                        node={folder}
                        selectedPath={selectedFolder}
                        onSelect={handleFolderSelect}
                      />
                    ))}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Search and Filters */}
          <div className="flex items-center gap-4 mb-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t('portal.searchPlaceholder', 'Search documents...')}
                value={searchTerm}
                onChange={(e) => handleSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <span className="text-sm text-muted-foreground">
              {t('portal.showing', '{{count}} documents', { count: total })}
            </span>
          </div>

          {/* Error State */}
          {loadError && (
            <div className="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
              {loadError}
            </div>
          )}

          {/* Document Grid */}
          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <Spinner size="sm" />
              </div>
            ) : documents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                <FileText className="w-12 h-12 mb-2 opacity-50" />
                <p>{t('empty.default', 'No documents found')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {documents.map((doc) => (
                  <DocumentCard
                    key={doc.document_id}
                    document={doc}
                    onDownload={handleDownload}
                    isDownloading={downloadingId === doc.document_id}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4 pt-4 border-t">
              <Button
                id="client-docs-previous-page"
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                {t('common:pagination.previous', 'Previous')}
              </Button>
              <span className="text-sm text-muted-foreground">
                {t('common:pagination.pageOf', 'Page {{current}} of {{total}}', { current: page, total: totalPages })}
              </span>
              <Button
                id="client-docs-next-page"
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                {t('common:pagination.next', 'Next')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
