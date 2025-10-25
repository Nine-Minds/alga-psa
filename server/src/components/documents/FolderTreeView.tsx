'use client';

import React, { useState, useEffect } from 'react';
import { IFolderNode } from '@/interfaces/document.interface';
import { getFolderTree, deleteFolder } from '@/lib/actions/document-actions/documentActions';
import { ChevronRight, ChevronDown, Folder, FolderOpen, Trash2, ChevronLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'server/src/lib/i18n/client';

interface FolderTreeViewProps {
  onFolderSelect: (folderPath: string | null) => void;
  selectedFolder: string | null;
  onFolderDeleted?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function FolderTreeView({
  onFolderSelect,
  selectedFolder,
  onFolderDeleted,
  isCollapsed = false,
  onToggleCollapse
}: FolderTreeViewProps) {
  const [folderTree, setFolderTree] = useState<IFolderNode[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation('common');

  useEffect(() => {
    loadFolderTree();
  }, []);

  // Auto-expand parent folders when a folder is selected
  useEffect(() => {
    if (selectedFolder) {
      const parts = selectedFolder.split('/').filter(p => p.length > 0);
      const newExpanded = new Set(expandedFolders);
      let currentPath = '';

      for (let i = 0; i < parts.length - 1; i++) {
        currentPath += '/' + parts[i];
        newExpanded.add(currentPath);
      }

      setExpandedFolders(newExpanded);
    }
  }, [selectedFolder]);

  async function loadFolderTree() {
    try {
      const tree = await getFolderTree();
      setFolderTree(tree);
    } catch (error) {
      console.error('Failed to load folder tree:', error);
      toast.error(t('documents.folders.loadFailed', 'Failed to load folder tree'));
    } finally {
      setLoading(false);
    }
  }

  function toggleFolder(path: string) {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedFolders(newExpanded);
  }

  async function handleDeleteFolder(path: string, e: React.MouseEvent) {
    e.stopPropagation();

    if (
      !confirm(
        t('documents.folders.deleteConfirm', {
          name: path,
          defaultValue: `Are you sure you want to delete the folder "${path}"? This will only work if the folder is empty.`
        })
      )
    ) {
      return;
    }

    try {
      await deleteFolder(path);
      toast.success(
        t('documents.folders.deleteSuccess', {
          name: path,
          defaultValue: `Folder "${path}" deleted successfully`
        })
      );

      // Reload tree and notify parent
      await loadFolderTree();
      if (onFolderDeleted) {
        onFolderDeleted();
      }

      // If the deleted folder was selected, reset selection
      if (selectedFolder === path) {
        onFolderSelect(null);
      }
    } catch (error) {
      console.error('Failed to delete folder:', error);
      const errorMessage =
        error instanceof Error && error.message
          ? error.message
          : t('documents.folders.deleteFailed', 'Failed to delete folder');
      toast.error(errorMessage);
    }
  }

  function renderFolderNode(node: IFolderNode, level: number = 0) {
    const isExpanded = expandedFolders.has(node.path);
    const isSelected = selectedFolder === node.path;
    const hasChildren = node.children.length > 0;

    return (
      <div key={node.path}>
        <div
          id={`folder-item-${node.path.replace(/\//g, '-')}`}
          className={`
            flex items-center gap-2 py-2 px-3 cursor-pointer group
            hover:bg-gray-100 dark:hover:bg-gray-800
            ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''}
          `}
          style={{ paddingLeft: `${level * 20 + 12}px` }}
          onClick={() => onFolderSelect(node.path)}
        >
          {hasChildren && (
            <button
              id={`folder-toggle-${node.path.replace(/\//g, '-')}`}
              onClick={(e) => {
                e.stopPropagation();
                toggleFolder(node.path);
              }}
              className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
          )}
          {!hasChildren && <div className="w-5" />}

          {isExpanded ? (
            <FolderOpen className="w-4 h-4 text-blue-500" />
          ) : (
            <Folder className="w-4 h-4 text-gray-500" />
          )}

          <span className="text-sm flex-1">{node.name}</span>
          <span className="text-xs text-gray-500">
            {node.documentCount}
          </span>
          <button
            id={`folder-delete-${node.path.replace(/\//g, '-')}`}
            onClick={(e) => handleDeleteFolder(node.path, e)}
            className="p-1 opacity-0 group-hover:opacity-100 hover:bg-red-100 dark:hover:bg-red-900/20 rounded transition-opacity"
            title={t('documents.folders.deleteAction', 'Delete folder')}
          >
            <Trash2 className="w-3.5 h-3.5 text-red-600" />
          </button>
        </div>

        {isExpanded && hasChildren && (
          <div>
            {node.children.map(child => renderFolderNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 text-sm text-gray-500">
        {t('documents.folders.loading', 'Loading folders...')}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto flex flex-col">
      <div className="p-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {t('documents.folders.title', 'Folders')}
        </h3>
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            title={t('documents.folders.collapse', 'Collapse folders')}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">

      <div
        id="folder-root"
        className={`
          flex items-center gap-2 py-2 px-3 cursor-pointer
          hover:bg-gray-100 dark:hover:bg-gray-800
          ${selectedFolder === null ? 'bg-blue-50 dark:bg-blue-900/20' : ''}
        `}
        onClick={() => onFolderSelect(null)}
      >
        <span className="text-sm font-mono text-gray-700 dark:text-gray-300">&lt;root&gt;</span>
      </div>

      {folderTree.map(node => renderFolderNode(node, 0))}
      </div>
    </div>
  );
}
