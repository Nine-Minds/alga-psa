'use client';

import React, { useState, useEffect, useCallback } from 'react';
import type { IFolderNode } from '@alga-psa/types';
import { getFolderTree, deleteFolder, toggleFolderVisibilityByPath } from '../actions/documentActions';
import { ChevronRight, ChevronDown, Folder, FolderOpen, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { handleError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { CollapseToggleButton } from '@alga-psa/ui/components/CollapseToggleButton';
import VisibilityToggle from './VisibilityToggle';

interface FolderTreeViewProps {
  onFolderSelect: (folderPath: string | null) => void;
  selectedFolder: string | null;
  entityId?: string;
  entityType?: string;
  showVisibilityIndicators?: boolean;
  onFolderDeleted?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function FolderTreeView({
  onFolderSelect,
  selectedFolder,
  entityId,
  entityType,
  showVisibilityIndicators = false,
  onFolderDeleted,
  isCollapsed = false,
  onToggleCollapse
}: FolderTreeViewProps) {
  const [folderTree, setFolderTree] = useState<IFolderNode[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [folderToDelete, setFolderToDelete] = useState<string | null>(null);
  const [visibilityTogglePending, setVisibilityTogglePending] = useState<{ node: IFolderNode; newValue: boolean } | null>(null);
  const { t } = useTranslation('common');

  const loadFolderTree = useCallback(async function loadFolderTree() {
    try {
      const tree = await getFolderTree(entityId ?? null, entityType ?? null);
      if (isActionPermissionError(tree)) {
        handleError(tree.permissionError);
        return;
      }
      setFolderTree(tree);
    } catch (error) {
      handleError(error, 'Failed to load folder tree');
    } finally {
      setLoading(false);
    }
  }, [entityId, entityType]);

  useEffect(() => {
    loadFolderTree();
  }, [loadFolderTree]);

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

  function toggleFolder(path: string) {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedFolders(newExpanded);
  }

  function handleDeleteFolder(path: string, e: React.MouseEvent) {
    e.stopPropagation();
    setFolderToDelete(path);
  }

  async function confirmDeleteFolder() {
    const path = folderToDelete;
    if (!path) return;
    setFolderToDelete(null);

    try {
      const deleteResult = await deleteFolder(path);
      if (isActionPermissionError(deleteResult)) {
        handleError(deleteResult.permissionError);
        return;
      }
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
      handleError(error, t('documents.folders.deleteFailed', 'Failed to delete folder'));
    }
  }

  function handleToggleVisibility(node: IFolderNode) {
    const newValue = !node.is_client_visible;
    if (node.documentCount > 0) {
      setVisibilityTogglePending({ node, newValue });
    } else {
      applyFolderVisibility(node, newValue, false);
    }
  }

  async function applyFolderVisibility(node: IFolderNode, newValue: boolean, cascade: boolean) {
    try {
      const result = await toggleFolderVisibilityByPath(
        node.path,
        newValue,
        entityId ?? null,
        entityType ?? null,
        cascade
      );
      if (isActionPermissionError(result)) {
        handleError(result.permissionError);
        return;
      }
      if (result.folderUpdated) {
        toast.success(
          newValue
            ? t('documents.visibility.markedVisible', { defaultValue: `"${node.name}" is now visible in client portal` })
            : t('documents.visibility.markedHidden', { defaultValue: `"${node.name}" is now hidden from client portal` })
        );
        await loadFolderTree();
      }
    } catch (error) {
      handleError(error, t('documents.visibility.toggleFailed', 'Failed to update folder visibility'));
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
            hover:bg-gray-100 dark:hover:bg-[rgb(var(--color-border-100))]
            ${isSelected ? 'bg-blue-50 dark:bg-[rgb(var(--color-border-100))]' : ''}
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
              className="p-0.5 hover:bg-gray-200 rounded"
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
          {showVisibilityIndicators && typeof node.is_client_visible === 'boolean' && (
            <div
              className="flex items-center"
              onClick={(e) => e.stopPropagation()}
              title={node.is_client_visible
                ? t('documents.visibility.clientVisible', 'Client visible')
                : t('documents.visibility.internalOnly', 'Internal only')}
            >
              <VisibilityToggle
                id={`folder-visibility-indicator-${node.path.replace(/\//g, '-')}`}
                isClientVisible={Boolean(node.is_client_visible)}
                onToggle={() => handleToggleVisibility(node)}
              />
            </div>
          )}
          <span className="text-xs text-gray-500">
            {node.documentCount}
          </span>
          <button
            id={`folder-delete-${node.path.replace(/\//g, '-')}`}
            onClick={(e) => handleDeleteFolder(node.path, e)}
            className="p-1 opacity-0 group-hover:opacity-100 hover:bg-red-100 rounded transition-opacity"
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
      <div className="p-3 border-b border-gray-200 dark:border-[rgb(var(--color-border-200))] flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {t('documents.folders.title', 'Folders')}
        </h3>
        {onToggleCollapse && (
          <CollapseToggleButton
            id="documents-collapse-folders-button"
            isCollapsed={false}
            collapsedLabel={t('documents.folders.expand', 'Show folders')}
            expandedLabel={t('documents.folders.collapse', 'Collapse folders')}
            expandDirection="right"
            onClick={onToggleCollapse}
          />
        )}
      </div>
      <div className="flex-1 overflow-y-auto">

      <div
        id="folder-root"
        className={`
          flex items-center gap-2 py-2 px-3 cursor-pointer
          hover:bg-gray-100 dark:hover:bg-[rgb(var(--color-border-100))]
          ${selectedFolder === null ? 'bg-blue-50 dark:bg-[rgb(var(--color-border-100))]' : ''}
        `}
        onClick={() => onFolderSelect(null)}
      >
        <span className="text-sm font-mono text-gray-700">&lt;root&gt;</span>
      </div>

      {folderTree.map(node => renderFolderNode(node, 0))}
      </div>

      <ConfirmationDialog
        isOpen={folderToDelete !== null}
        onClose={() => setFolderToDelete(null)}
        onConfirm={confirmDeleteFolder}
        title={t('documents.folders.deleteTitle', 'Delete Folder')}
        message={t('documents.folders.deleteConfirm', {
          name: folderToDelete ?? '',
          defaultValue: `Are you sure you want to delete the folder "${folderToDelete}"? This will only work if the folder is empty.`
        })}
        confirmLabel={t('documents.folders.deleteAction', 'Delete')}
      />

      <ConfirmationDialog
        isOpen={visibilityTogglePending !== null}
        onClose={() => {
          if (visibilityTogglePending) {
            applyFolderVisibility(visibilityTogglePending.node, visibilityTogglePending.newValue, false);
          }
          setVisibilityTogglePending(null);
        }}
        onConfirm={() => {
          if (visibilityTogglePending) {
            applyFolderVisibility(visibilityTogglePending.node, visibilityTogglePending.newValue, true);
          }
          setVisibilityTogglePending(null);
        }}
        title={t('documents.visibility.cascadeTitle', 'Update document visibility')}
        message={
          visibilityTogglePending?.newValue
            ? t('documents.visibility.cascadeMakeVisible', {
                name: visibilityTogglePending?.node.name ?? '',
                count: visibilityTogglePending?.node.documentCount ?? 0,
                defaultValue: `Would you also like to make all ${visibilityTogglePending?.node.documentCount ?? 0} document(s) in "${visibilityTogglePending?.node.name ?? ''}" visible to the client portal?`
              })
            : t('documents.visibility.cascadeMakeHidden', {
                name: visibilityTogglePending?.node.name ?? '',
                count: visibilityTogglePending?.node.documentCount ?? 0,
                defaultValue: `Would you also like to hide all ${visibilityTogglePending?.node.documentCount ?? 0} document(s) in "${visibilityTogglePending?.node.name ?? ''}" from the client portal?`
              })
        }
        confirmLabel={t('documents.visibility.cascadeYes', 'Yes, update documents')}
        cancelLabel={t('documents.visibility.cascadeNo', 'No, folder only')}
      />
    </div>
  );
}
