'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Plus, MoreVertical, Trash2, Pencil, Copy, Eye, EyeOff, FileText, Zap, Download } from 'lucide-react';
import { DataTable } from 'server/src/components/ui/DataTable';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from 'server/src/components/ui/Dialog';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from 'server/src/components/ui/DropdownMenu';
import { toast } from 'react-hot-toast';
import { Badge } from 'server/src/components/ui/Badge';
import { ITicketTemplate, TicketTemplateType } from 'server/src/interfaces/ticketTemplate.interfaces';
import {
  getTicketTemplates,
  deleteTicketTemplate,
  duplicateTicketTemplate,
  toggleTemplateActive,
  seedITILTemplates
} from 'server/src/lib/actions/ticketTemplateActions';
import { TemplateEditor } from './TemplateEditor';
import { ITILTemplateLibrary } from './ITILTemplateLibrary';

interface TicketTemplatesManagerProps {
  className?: string;
}

export function TicketTemplatesManager({ className = '' }: TicketTemplatesManagerProps) {
  const [templates, setTemplates] = useState<ITicketTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog states
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ITicketTemplate | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<ITicketTemplate | null>(null);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [templateToDuplicate, setTemplateToDuplicate] = useState<ITicketTemplate | null>(null);
  const [itilLibraryOpen, setItilLibraryOpen] = useState(false);

  // Filter state
  const [filterType, setFilterType] = useState<TicketTemplateType | 'all'>('all');

  const loadTemplates = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const filters = filterType !== 'all' ? { template_type: filterType } : undefined;
      const data = await getTicketTemplates(filters);
      setTemplates(data);
    } catch (err) {
      console.error('Error loading templates:', err);
      setError(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, [filterType]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const handleCreateNew = () => {
    setEditingTemplate(null);
    setEditorOpen(true);
  };

  const handleEdit = (template: ITicketTemplate) => {
    setEditingTemplate(template);
    setEditorOpen(true);
  };

  const handleEditorClose = (saved: boolean) => {
    setEditorOpen(false);
    setEditingTemplate(null);
    if (saved) {
      loadTemplates();
    }
  };

  const handleDeleteClick = (template: ITicketTemplate) => {
    setTemplateToDelete(template);
    setDeleteConfirmOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!templateToDelete) return;

    try {
      await deleteTicketTemplate(templateToDelete.template_id);
      toast.success('Template deleted');
      loadTemplates();
    } catch (err) {
      console.error('Error deleting template:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to delete template');
    } finally {
      setDeleteConfirmOpen(false);
      setTemplateToDelete(null);
    }
  };

  const handleDuplicateClick = (template: ITicketTemplate) => {
    setTemplateToDuplicate(template);
    setDuplicateDialogOpen(true);
  };

  const handleDuplicateConfirm = async (newName: string) => {
    if (!templateToDuplicate) return;

    try {
      await duplicateTicketTemplate(templateToDuplicate.template_id, newName);
      toast.success('Template duplicated');
      loadTemplates();
    } catch (err) {
      console.error('Error duplicating template:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to duplicate template');
    } finally {
      setDuplicateDialogOpen(false);
      setTemplateToDuplicate(null);
    }
  };

  const handleToggleActive = async (template: ITicketTemplate) => {
    try {
      await toggleTemplateActive(template.template_id, !template.is_active);
      toast.success(template.is_active ? 'Template deactivated' : 'Template activated');
      loadTemplates();
    } catch (err) {
      console.error('Error toggling template:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to update template');
    }
  };

  const handleSeedITIL = async () => {
    try {
      const result = await seedITILTemplates();
      if (result.created > 0) {
        toast.success(`Created ${result.created} ITIL templates`);
        loadTemplates();
      } else {
        toast.success('All ITIL templates already exist');
      }
    } catch (err) {
      console.error('Error seeding ITIL templates:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to seed ITIL templates');
    }
  };

  const columns: ColumnDefinition<ITicketTemplate>[] = [
    {
      title: 'Name',
      dataIndex: 'name',
      render: (_, template) => (
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-gray-400" />
          <div>
            <span className="font-medium">{template.name}</span>
            {template.description && (
              <p className="text-xs text-gray-500 line-clamp-1">{template.description}</p>
            )}
          </div>
        </div>
      )
    },
    {
      title: 'Type',
      dataIndex: 'template_type',
      render: (type: TicketTemplateType) => (
        <Badge variant={type === 'itil' ? 'default' : 'outline'}>
          {type === 'itil' ? 'ITIL' : 'Custom'}
        </Badge>
      )
    },
    {
      title: 'Category',
      dataIndex: 'itil_config',
      render: (_, template) => (
        <span className="text-sm text-gray-600">
          {template.itil_config?.itil_category || '-'}
        </span>
      )
    },
    {
      title: 'Status',
      dataIndex: 'is_active',
      render: (isActive: boolean) => (
        <Badge variant={isActive ? 'default' : 'secondary'}>
          {isActive ? 'Active' : 'Inactive'}
        </Badge>
      )
    },
    {
      title: 'Actions',
      dataIndex: 'template_id',
      render: (_, template) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button id={`template-actions-${template.template_id}`} variant="ghost" size="sm">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleEdit(template)}>
              <Pencil className="w-4 h-4 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleDuplicateClick(template)}>
              <Copy className="w-4 h-4 mr-2" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleToggleActive(template)}>
              {template.is_active ? (
                <>
                  <EyeOff className="w-4 h-4 mr-2" />
                  Deactivate
                </>
              ) : (
                <>
                  <Eye className="w-4 h-4 mr-2" />
                  Activate
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => handleDeleteClick(template)}
              className="text-red-600"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
  ];

  if (loading) {
    return (
      <div className={`flex items-center justify-center py-12 ${className}`}>
        <LoadingIndicator text="Loading templates..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`text-center py-12 ${className}`}>
        <p className="text-red-600 mb-4">{error}</p>
        <Button id="retry-load-templates" onClick={loadTemplates}>Retry</Button>
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Ticket Templates</h2>
          <p className="text-sm text-gray-500">
            Pre-defined ticket types with default values for common scenarios
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            id="open-itil-library"
            variant="outline"
            onClick={() => setItilLibraryOpen(true)}
          >
            <Download className="w-4 h-4 mr-2" />
            ITIL Library
          </Button>
          <Button id="create-new-template" onClick={handleCreateNew}>
            <Plus className="w-4 h-4 mr-2" />
            Create Template
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Filter:</span>
          <div className="flex gap-1">
            <Button
              id="filter-all"
              variant={filterType === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterType('all')}
            >
              All
            </Button>
            <Button
              id="filter-itil"
              variant={filterType === 'itil' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterType('itil')}
            >
              ITIL
            </Button>
            <Button
              id="filter-custom"
              variant={filterType === 'custom' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterType('custom')}
            >
              Custom
            </Button>
          </div>
        </div>
      </div>

      {/* Templates Table */}
      {templates.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No templates yet</h3>
          <p className="text-gray-500 mb-4">
            Create custom templates or import ITIL templates to get started
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button id="seed-itil-templates" variant="outline" onClick={handleSeedITIL}>
              <Zap className="w-4 h-4 mr-2" />
              Import ITIL Templates
            </Button>
            <Button id="create-first-template" onClick={handleCreateNew}>
              <Plus className="w-4 h-4 mr-2" />
              Create Template
            </Button>
          </div>
        </div>
      ) : (
        <DataTable
          data={templates}
          columns={columns}
          pagination={true}
          currentPage={1}
          pageSize={10}
          onPageChange={() => {}}
        />
      )}

      {/* Template Editor Dialog */}
      <Dialog open={editorOpen} onOpenChange={(open) => !open && handleEditorClose(false)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? 'Edit Template' : 'Create Template'}
            </DialogTitle>
          </DialogHeader>
          <TemplateEditor
            template={editingTemplate}
            onSave={() => handleEditorClose(true)}
            onCancel={() => handleEditorClose(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmationDialog
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Template"
        message={`Are you sure you want to delete "${templateToDelete?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="destructive"
      />

      {/* Duplicate Dialog */}
      <DuplicateTemplateDialog
        isOpen={duplicateDialogOpen}
        templateName={templateToDuplicate?.name || ''}
        onClose={() => setDuplicateDialogOpen(false)}
        onConfirm={handleDuplicateConfirm}
      />

      {/* ITIL Library Dialog */}
      <Dialog open={itilLibraryOpen} onOpenChange={setItilLibraryOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>ITIL Template Library</DialogTitle>
          </DialogHeader>
          <ITILTemplateLibrary
            onImport={() => {
              setItilLibraryOpen(false);
              loadTemplates();
            }}
            onClose={() => setItilLibraryOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface DuplicateTemplateDialogProps {
  isOpen: boolean;
  templateName: string;
  onClose: () => void;
  onConfirm: (newName: string) => void;
}

function DuplicateTemplateDialog({
  isOpen,
  templateName,
  onClose,
  onConfirm
}: DuplicateTemplateDialogProps) {
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (isOpen) {
      setNewName(`${templateName} (Copy)`);
    }
  }, [isOpen, templateName]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate Template</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <label htmlFor="duplicate-name" className="block text-sm font-medium text-gray-700 mb-1">
            New Template Name
          </label>
          <input
            id="duplicate-name"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button id="cancel-duplicate" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            id="confirm-duplicate"
            onClick={() => onConfirm(newName)}
            disabled={!newName.trim()}
          >
            Duplicate
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default TicketTemplatesManager;
