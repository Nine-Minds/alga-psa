'use client';

import React, { useState, useCallback } from 'react';
import FolderTemplateList from './FolderTemplateList';
import FolderTemplateEditor from './FolderTemplateEditor';
import { IDocumentFolderTemplate } from '@alga-psa/documents/actions';

type ViewMode = 'list' | 'create' | 'edit';

interface DocumentTemplatesSettingsProps {
  defaultEntityType?: string | null;
}

export default function DocumentTemplatesSettings({
  defaultEntityType = null,
}: DocumentTemplatesSettingsProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [listKey, setListKey] = useState(0);

  const handleCreateNew = useCallback(() => {
    setEditingTemplateId(null);
    setViewMode('create');
  }, []);

  const handleEdit = useCallback((template: IDocumentFolderTemplate) => {
    setEditingTemplateId(template.template_id);
    setViewMode('edit');
  }, []);

  const handleSave = useCallback(() => {
    setViewMode('list');
    setEditingTemplateId(null);
    // Force list refresh
    setListKey((k) => k + 1);
  }, []);

  const handleCancel = useCallback(() => {
    setViewMode('list');
    setEditingTemplateId(null);
  }, []);

  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-800">Document Folder Templates</h2>
          <p className="text-sm text-gray-600 mt-1">
            Configure default folder structures that are automatically created when documents are first accessed for an entity.
          </p>
        </div>

        {viewMode === 'list' && (
          <FolderTemplateList
            key={listKey}
            entityTypeFilter={defaultEntityType}
            onEdit={handleEdit}
            onCreateNew={handleCreateNew}
          />
        )}

        {(viewMode === 'create' || viewMode === 'edit') && (
          <FolderTemplateEditor
            templateId={editingTemplateId}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        )}
      </div>
    </div>
  );
}
