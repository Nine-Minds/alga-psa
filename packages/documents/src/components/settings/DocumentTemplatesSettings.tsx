'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge } from '@alga-psa/ui/components/Badge';
import {
  Plus,
  Trash2,
  FolderTree,
  Eye,
  EyeOff,
  ChevronRight,
  ChevronDown,
  Download,
  Save,
  Info,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { handleError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getDefaultFolders,
  saveDefaultFolders,
  removeDefaultFolders,
  loadSuggestedDefaults,
  IDefaultFolder,
} from '@alga-psa/documents/actions';

const ENTITY_TYPE_LABELS: Record<string, string> = {
  ticket: 'Ticket',
  project_task: 'Project Task',
  client: 'Client',
  contact: 'Contact',
  asset: 'Asset',
  contract: 'Contract',
};

const ENTITY_TYPE_COLORS: Record<string, string> = {
  ticket: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  project_task: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  client: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  contact: 'bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300',
  asset: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300',
  contract: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
};

interface FolderItem {
  folderPath: string;
  isClientVisible: boolean;
  sortOrder: number;
}

interface EntitySection {
  entityType: string;
  folders: FolderItem[];
  isExpanded: boolean;
  isDirty: boolean;
  isSaving: boolean;
}

export default function DocumentTemplatesSettings() {
  const { t } = useTranslation('features/documents');
  const [sections, setSections] = useState<EntitySection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingSuggested, setIsLoadingSuggested] = useState(false);
  const [newFolderInputs, setNewFolderInputs] = useState<Record<string, string>>({});

  const loadDefaults = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getDefaultFolders();
      if (isActionPermissionError(result)) {
        handleError(result.permissionError);
        return;
      }

      const folders = result as IDefaultFolder[];
      const grouped: Record<string, FolderItem[]> = {};
      for (const f of folders) {
        if (!grouped[f.entity_type]) grouped[f.entity_type] = [];
        grouped[f.entity_type].push({
          folderPath: f.folder_path,
          isClientVisible: f.is_client_visible,
          sortOrder: f.sort_order,
        });
      }

      const entityTypes = Object.keys(grouped).sort((a, b) =>
        (ENTITY_TYPE_LABELS[a] || a).localeCompare(ENTITY_TYPE_LABELS[b] || b)
      );

      setSections(entityTypes.map(et => ({
        entityType: et,
        folders: grouped[et].sort((a, b) => a.sortOrder - b.sortOrder),
        isExpanded: true,
        isDirty: false,
        isSaving: false,
      })));
    } catch (error) {
      handleError(error, t('messages.defaultFoldersLoadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDefaults();
  }, [loadDefaults]);

  const updateSection = (entityType: string, update: Partial<EntitySection>) => {
    setSections(prev =>
      prev.map(s => s.entityType === entityType ? { ...s, ...update } : s)
    );
  };

  const handleToggleExpand = (entityType: string) => {
    updateSection(entityType, {
      isExpanded: !sections.find(s => s.entityType === entityType)?.isExpanded,
    });
  };

  const handleToggleVisibility = (entityType: string, folderPath: string) => {
    const section = sections.find(s => s.entityType === entityType);
    if (!section) return;

    updateSection(entityType, {
      folders: section.folders.map(f =>
        f.folderPath === folderPath ? { ...f, isClientVisible: !f.isClientVisible } : f
      ),
      isDirty: true,
    });
  };

  const handleRemoveFolder = (entityType: string, folderPath: string) => {
    const section = sections.find(s => s.entityType === entityType);
    if (!section) return;

    updateSection(entityType, {
      folders: section.folders.filter(f =>
        f.folderPath !== folderPath && !f.folderPath.startsWith(folderPath + '/')
      ),
      isDirty: true,
    });
  };

  const handleAddFolder = (entityType: string) => {
    const name = (newFolderInputs[entityType] || '').trim();
    if (!name) {
      toast.error(t('messages.folderPathRequired'));
      return;
    }

    const path = name.startsWith('/') ? name : `/${name}`;
    const section = sections.find(s => s.entityType === entityType);
    if (!section) return;

    if (section.folders.some(f => f.folderPath === path)) {
      toast.error(t('messages.folderAlreadyExists'));
      return;
    }

    updateSection(entityType, {
      folders: [
        ...section.folders,
        { folderPath: path, isClientVisible: false, sortOrder: section.folders.length },
      ],
      isDirty: true,
    });

    setNewFolderInputs(prev => ({ ...prev, [entityType]: '' }));
  };

  const handleSave = async (entityType: string) => {
    const section = sections.find(s => s.entityType === entityType);
    if (!section) return;

    updateSection(entityType, { isSaving: true });
    try {
      const items = section.folders.map((f, i) => ({
        folderPath: f.folderPath,
        isClientVisible: f.isClientVisible,
        sortOrder: i,
      }));

      if (items.length === 0) {
        const result = await removeDefaultFolders(entityType);
        if (isActionPermissionError(result)) {
          handleError(result.permissionError);
          return;
        }
        setSections(prev => prev.filter(s => s.entityType !== entityType));
        toast.success(t('messages.defaultsRemoved', { entity: ENTITY_TYPE_LABELS[entityType] || entityType }));
      } else {
        const result = await saveDefaultFolders(entityType, items);
        if (isActionPermissionError(result)) {
          handleError(result.permissionError);
          return;
        }
        updateSection(entityType, { isDirty: false });
        toast.success(t('messages.defaultsSaved', { entity: ENTITY_TYPE_LABELS[entityType] || entityType }));
      }
    } catch (error) {
      handleError(error, t('messages.defaultsSaveFailed'));
    } finally {
      updateSection(entityType, { isSaving: false });
    }
  };

  const handleLoadSuggested = async () => {
    setIsLoadingSuggested(true);
    try {
      const result = await loadSuggestedDefaults();
      if (isActionPermissionError(result)) {
        handleError(result.permissionError);
        return;
      }
      if (result === 0) {
        toast.success(t('messages.suggestedDefaultsAllLoaded'));
      } else {
        toast.success(t('messages.suggestedDefaultsLoaded', { count: result }));
        await loadDefaults();
      }
    } catch (error) {
      handleError(error, t('messages.suggestedDefaultsLoadFailed'));
    } finally {
      setIsLoadingSuggested(false);
    }
  };

  const handleAddEntityType = () => {
    const allTypes = Object.keys(ENTITY_TYPE_LABELS);
    const usedTypes = new Set(sections.map(s => s.entityType));
    const available = allTypes.filter(t => !usedTypes.has(t));

    if (available.length === 0) {
      toast.error(t('messages.entityTypesAllConfigured'));
      return;
    }

    const nextType = available[0];
    setSections(prev => [
      ...prev,
      {
        entityType: nextType,
        folders: [],
        isExpanded: true,
        isDirty: true,
        isSaving: false,
      },
    ]);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div>
      {/* Explanation banner */}
      <div className="flex items-start gap-3 p-4 mb-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40">
        <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-800 dark:text-blue-300">
          <p className="font-medium mb-1">How default folders work</p>
          <p>
            These folders are automatically created when documents are first accessed for an entity (e.g. opening a client&apos;s documents).
            Each client, ticket, or other entity gets its own copy of these folders &mdash; documents are always separated per entity.
            You don&apos;t need to create folders like &quot;Client A / Invoices&quot;, &quot;Client B / Invoices&quot; &mdash; just define &quot;/Invoices&quot; once and every client gets their own.
          </p>
          <p className="mt-1">
            Folders marked with <Eye className="w-3.5 h-3.5 inline text-green-600" /> are visible in the client portal.
          </p>
        </div>
      </div>

      {sections.length === 0 ? (
        <div className="py-12 text-center">
          <FolderTree className="w-12 h-12 mx-auto mb-4 text-gray-400 dark:text-gray-600 opacity-50" />
          <p className="text-gray-500 dark:text-[rgb(var(--color-text-400))] mb-4">No default folders configured yet</p>
          <div className="flex gap-2 justify-center">
            <Button
              id="default-folders-load-suggested"
              onClick={handleLoadSuggested}
              disabled={isLoadingSuggested}
            >
              <Download className="w-4 h-4 mr-2" />
              {isLoadingSuggested ? 'Loading...' : 'Load Suggested Defaults'}
            </Button>
            <Button id="default-folders-add-type" onClick={handleAddEntityType} variant="outline">
              <Plus className="w-4 h-4 mr-2" />
              Add Entity Type
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {sections.map((section) => (
            <div key={section.entityType} className="border border-gray-200 dark:border-[rgb(var(--color-border-200))] rounded-lg">
              {/* Section header */}
              <button
                className="w-full flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-[rgb(var(--color-border-50))] transition-colors rounded-t-lg"
                onClick={() => handleToggleExpand(section.entityType)}
              >
                <div className="flex items-center gap-2">
                  {section.isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  )}
                  <Badge className={ENTITY_TYPE_COLORS[section.entityType] || 'bg-gray-100 text-gray-800'}>
                    {ENTITY_TYPE_LABELS[section.entityType] || section.entityType}
                  </Badge>
                  <span className="text-sm text-gray-500 dark:text-[rgb(var(--color-text-400))]">
                    {section.folders.length} folder{section.folders.length !== 1 ? 's' : ''}
                  </span>
                  {section.isDirty && (
                    <span className="text-xs text-amber-600 font-medium">unsaved</span>
                  )}
                </div>
              </button>

              {/* Section body */}
              {section.isExpanded && (
                <div className="border-t border-gray-200 dark:border-[rgb(var(--color-border-200))] px-3 pb-3">
                  {section.folders.length === 0 ? (
                    <p className="text-sm text-gray-400 py-3 text-center">No folders yet</p>
                  ) : (
                    <div className="mt-2 space-y-1">
                      {section.folders.map((folder) => {
                        const depth = folder.folderPath.split('/').filter(Boolean).length - 1;
                        return (
                          <div
                            key={folder.folderPath}
                            className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-50 dark:hover:bg-[rgb(var(--color-border-50))]"
                            style={{ paddingLeft: `${depth * 16 + 8}px` }}
                          >
                            <FolderTree className="w-4 h-4 text-gray-400 flex-shrink-0" />
                            <span className="text-sm flex-1 font-mono">{folder.folderPath}</span>
                            <button
                              onClick={() => handleToggleVisibility(section.entityType, folder.folderPath)}
                              className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-[rgb(var(--color-border-200))] ${
                                folder.isClientVisible ? 'text-green-600' : 'text-gray-400'
                              }`}
                              title={folder.isClientVisible ? 'Visible in client portal' : 'Hidden from client portal'}
                            >
                              {folder.isClientVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => handleRemoveFolder(section.entityType, folder.folderPath)}
                              className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Add folder input */}
                  <div className="flex items-center gap-2 mt-3">
                    <Input
                      value={newFolderInputs[section.entityType] || ''}
                      onChange={(e) =>
                        setNewFolderInputs(prev => ({ ...prev, [section.entityType]: e.target.value }))
                      }
                      placeholder="/FolderName or /Parent/Child"
                      className="flex-1 h-8 text-sm font-mono"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddFolder(section.entityType);
                      }}
                    />
                    <Button
                      id={`default-folders-add-${section.entityType}`}
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => handleAddFolder(section.entityType)}
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      Add
                    </Button>
                  </div>

                  {/* Save button */}
                  {section.isDirty && (
                    <div className="mt-3 flex justify-end">
                      <Button
                        id={`default-folders-save-${section.entityType}`}
                        size="sm"
                        onClick={() => handleSave(section.entityType)}
                        disabled={section.isSaving}
                      >
                        <Save className="w-3 h-3 mr-1" />
                        {section.isSaving ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Bottom actions */}
          <div className="flex gap-2 pt-2">
            <Button id="default-folders-add-type" onClick={handleAddEntityType} variant="outline" size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Add Entity Type
            </Button>
            <Button
              id="default-folders-load-suggested"
              variant="outline"
              size="sm"
              onClick={handleLoadSuggested}
              disabled={isLoadingSuggested}
            >
              <Download className="w-4 h-4 mr-2" />
              {isLoadingSuggested ? 'Loading...' : 'Load Suggested Defaults'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
