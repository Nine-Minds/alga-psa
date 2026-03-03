'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Plus, MoreVertical, Pencil, Trash2, Star, FolderTree } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@alga-psa/ui/components/DropdownMenu';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import {
  getFolderTemplates,
  deleteFolderTemplate,
  setDefaultTemplate,
  IDocumentFolderTemplate,
} from '@alga-psa/documents/actions';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';

const ENTITY_TYPE_LABELS: Record<string, string> = {
  ticket: 'Ticket',
  project: 'Project',
  project_task: 'Project Task',
  client: 'Client',
  contract: 'Contract',
};

const ENTITY_TYPE_COLORS: Record<string, string> = {
  ticket: 'bg-blue-100 text-blue-800',
  project: 'bg-green-100 text-green-800',
  project_task: 'bg-purple-100 text-purple-800',
  client: 'bg-orange-100 text-orange-800',
  contract: 'bg-teal-100 text-teal-800',
};

interface FolderTemplateListProps {
  entityTypeFilter?: string | null;
  onEdit?: (template: IDocumentFolderTemplate) => void;
  onCreateNew?: () => void;
}

export default function FolderTemplateList({
  entityTypeFilter = null,
  onEdit,
  onCreateNew,
}: FolderTemplateListProps) {
  const [templates, setTemplates] = useState<IDocumentFolderTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<IDocumentFolderTemplate | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSettingDefault, setIsSettingDefault] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getFolderTemplates(entityTypeFilter ?? undefined);
      if ('code' in result && result.code === 'PERMISSION_DENIED') {
        toast.error('Permission denied');
        setTemplates([]);
        return;
      }
      setTemplates(result as IDocumentFolderTemplate[]);
    } catch (error) {
      handleError(error, 'Failed to load folder templates');
      setTemplates([]);
    } finally {
      setIsLoading(false);
    }
  }, [entityTypeFilter]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const handleDelete = async () => {
    if (!templateToDelete) return;

    setIsDeleting(true);
    try {
      const result = await deleteFolderTemplate(templateToDelete.template_id);
      if (typeof result === 'object' && 'code' in result) {
        toast.error('Failed to delete template');
        return;
      }
      if (result) {
        toast.success('Template deleted');
        await loadTemplates();
      } else {
        toast.error('Template not found');
      }
    } catch (error) {
      handleError(error, 'Failed to delete template');
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setTemplateToDelete(null);
    }
  };

  const handleSetDefault = async (template: IDocumentFolderTemplate) => {
    if (template.is_default) return;

    setIsSettingDefault(template.template_id);
    try {
      const result = await setDefaultTemplate(template.template_id);
      if (result && typeof result === 'object' && 'code' in result) {
        toast.error('Failed to set default template');
        return;
      }
      if (result) {
        toast.success(`"${template.name}" is now the default for ${ENTITY_TYPE_LABELS[template.entity_type] || template.entity_type}`);
        await loadTemplates();
      }
    } catch (error) {
      handleError(error, 'Failed to set default template');
    } finally {
      setIsSettingDefault(null);
    }
  };

  const confirmDelete = (template: IDocumentFolderTemplate) => {
    setTemplateToDelete(template);
    setDeleteDialogOpen(true);
  };

  // Group templates by entity type
  const groupedTemplates = templates.reduce(
    (acc, template) => {
      const entityType = template.entity_type;
      if (!acc[entityType]) {
        acc[entityType] = [];
      }
      acc[entityType].push(template);
      return acc;
    },
    {} as Record<string, IDocumentFolderTemplate[]>
  );

  const sortedEntityTypes = Object.keys(groupedTemplates).sort((a, b) => {
    const labelA = ENTITY_TYPE_LABELS[a] || a;
    const labelB = ENTITY_TYPE_LABELS[b] || b;
    return labelA.localeCompare(labelB);
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Folder Templates</h3>
          <p className="text-sm text-muted-foreground">
            Define default folder structures for different entity types
          </p>
        </div>
        {onCreateNew && (
          <Button id="template-list-create" onClick={onCreateNew} size="sm">
            <Plus className="w-4 h-4 mr-2" />
            New Template
          </Button>
        )}
      </div>

      {templates.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FolderTree className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground mb-4">No folder templates defined yet</p>
            {onCreateNew && (
              <Button id="template-list-create-empty" onClick={onCreateNew} variant="outline">
                <Plus className="w-4 h-4 mr-2" />
                Create Your First Template
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {sortedEntityTypes.map((entityType) => (
            <div key={entityType} className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge className={ENTITY_TYPE_COLORS[entityType] || 'bg-gray-100 text-gray-800'}>
                  {ENTITY_TYPE_LABELS[entityType] || entityType}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  ({groupedTemplates[entityType].length} template{groupedTemplates[entityType].length !== 1 ? 's' : ''})
                </span>
              </div>

              <div className="grid gap-3">
                {groupedTemplates[entityType].map((template) => (
                  <Card key={template.template_id} className="hover:shadow-sm transition-shadow">
                    <CardContent className="py-3 px-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <FolderTree className="w-5 h-5 text-muted-foreground" />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{template.name}</span>
                              {template.is_default && (
                                <Badge variant="default" className="text-xs">
                                  <Star className="w-3 h-3 mr-1" />
                                  Default
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Created {new Date(template.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        </div>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button id={`template-actions-${template.template_id}`} variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {onEdit && (
                              <DropdownMenuItem onClick={() => onEdit(template)}>
                                <Pencil className="w-4 h-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                            )}
                            {!template.is_default && (
                              <DropdownMenuItem
                                onClick={() => handleSetDefault(template)}
                                disabled={isSettingDefault === template.template_id}
                              >
                                <Star className="w-4 h-4 mr-2" />
                                Set as Default
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() => confirmDelete(template)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmationDialog
        isOpen={deleteDialogOpen}
        onClose={() => {
          setDeleteDialogOpen(false);
          setTemplateToDelete(null);
        }}
        onConfirm={handleDelete}
        title="Delete Template"
        message={`Are you sure you want to delete "${templateToDelete?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        isConfirming={isDeleting}
      />
    </div>
  );
}
