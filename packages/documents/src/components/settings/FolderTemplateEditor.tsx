'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import {
  Plus,
  Trash2,
  GripVertical,
  FolderOpen,
  Eye,
  EyeOff,
  ChevronRight,
  ChevronDown,
  Save,
  X,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import {
  getFolderTemplate,
  createFolderTemplate,
  updateFolderTemplate,
  IDocumentFolderTemplate,
  IDocumentFolderTemplateItem,
  ICreateFolderTemplateInput,
  IUpdateFolderTemplateInput,
} from '@alga-psa/documents/actions';

const ENTITY_TYPES = [
  { value: 'ticket', label: 'Ticket' },
  { value: 'project', label: 'Project' },
  { value: 'project_task', label: 'Project Task' },
  { value: 'client', label: 'Client' },
  { value: 'contract', label: 'Contract' },
];

interface TemplateItemNode {
  id: string;
  folderName: string;
  folderPath: string;
  isClientVisible: boolean;
  sortOrder: number;
  children: TemplateItemNode[];
  isExpanded: boolean;
}

interface FolderTemplateEditorProps {
  templateId?: string | null;
  onSave?: (template: IDocumentFolderTemplate) => void;
  onCancel?: () => void;
}

function buildTreeFromItems(items: IDocumentFolderTemplateItem[]): TemplateItemNode[] {
  // Sort items by path depth, then sort_order
  const sortedItems = [...items].sort((a, b) => {
    const depthA = a.folder_path.split('/').filter(Boolean).length;
    const depthB = b.folder_path.split('/').filter(Boolean).length;
    if (depthA !== depthB) return depthA - depthB;
    return a.sort_order - b.sort_order;
  });

  const nodeMap = new Map<string, TemplateItemNode>();
  const roots: TemplateItemNode[] = [];

  for (const item of sortedItems) {
    const node: TemplateItemNode = {
      id: item.template_item_id,
      folderName: item.folder_name,
      folderPath: item.folder_path,
      isClientVisible: item.is_client_visible,
      sortOrder: item.sort_order,
      children: [],
      isExpanded: true,
    };

    nodeMap.set(item.folder_path, node);

    // Find parent path
    const segments = item.folder_path.split('/').filter(Boolean);
    if (segments.length <= 1) {
      roots.push(node);
    } else {
      const parentPath = '/' + segments.slice(0, -1).join('/');
      const parent = nodeMap.get(parentPath);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
  }

  return roots;
}

function flattenTree(nodes: TemplateItemNode[], result: { folderPath: string; sortOrder: number; isClientVisible: boolean }[] = []) {
  for (const node of nodes) {
    result.push({
      folderPath: node.folderPath,
      sortOrder: node.sortOrder,
      isClientVisible: node.isClientVisible,
    });
    if (node.children.length > 0) {
      flattenTree(node.children, result);
    }
  }
  return result;
}

export default function FolderTemplateEditor({
  templateId = null,
  onSave,
  onCancel,
}: FolderTemplateEditorProps) {
  const [isLoading, setIsLoading] = useState(!!templateId);
  const [isSaving, setIsSaving] = useState(false);
  const [name, setName] = useState('');
  const [entityType, setEntityType] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [items, setItems] = useState<TemplateItemNode[]>([]);
  const [newFolderName, setNewFolderName] = useState('');
  const [addingToPath, setAddingToPath] = useState<string | null>(null);
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const nextIdRef = useRef(1);
  const generateTempId = useCallback((): string => {
    return `temp-${nextIdRef.current++}`;
  }, []);

  const loadTemplate = useCallback(async () => {
    if (!templateId) return;

    setIsLoading(true);
    try {
      const result = await getFolderTemplate(templateId);
      if (!result || (typeof result === 'object' && 'code' in result)) {
        toast.error('Template not found');
        onCancel?.();
        return;
      }

      const template = result as IDocumentFolderTemplate & { items: IDocumentFolderTemplateItem[] };
      setName(template.name);
      setEntityType(template.entity_type);
      setIsDefault(template.is_default);
      setItems(buildTreeFromItems(template.items || []));
    } catch (error) {
      handleError(error, 'Failed to load template');
      onCancel?.();
    } finally {
      setIsLoading(false);
    }
  }, [templateId, onCancel]);

  useEffect(() => {
    loadTemplate();
  }, [loadTemplate]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Template name is required');
      return;
    }
    if (!entityType) {
      toast.error('Entity type is required');
      return;
    }

    setIsSaving(true);
    try {
      const flatItems = flattenTree(items);
      const itemsInput = flatItems.map((item, index) => ({
        folderPath: item.folderPath,
        sortOrder: index,
        isClientVisible: item.isClientVisible,
      }));

      let result;
      if (templateId) {
        const updateData: IUpdateFolderTemplateInput = {
          name: name.trim(),
          entityType,
          isDefault,
          items: itemsInput,
        };
        result = await updateFolderTemplate(templateId, updateData);
      } else {
        const createData: ICreateFolderTemplateInput = {
          name: name.trim(),
          entityType,
          isDefault,
          items: itemsInput,
        };
        result = await createFolderTemplate(createData);
      }

      if (typeof result === 'object' && 'code' in result) {
        toast.error('Failed to save template');
        return;
      }

      toast.success(templateId ? 'Template updated' : 'Template created');
      onSave?.(result as IDocumentFolderTemplate);
    } catch (error) {
      handleError(error, 'Failed to save template');
    } finally {
      setIsSaving(false);
    }
  };

  const addFolder = (parentPath: string | null) => {
    if (!newFolderName.trim()) {
      toast.error('Folder name is required');
      return;
    }

    const folderName = newFolderName.trim();
    const folderPath = parentPath ? `${parentPath}/${folderName}` : `/${folderName}`;

    // Check for duplicates
    const allPaths = flattenTree(items).map((i) => i.folderPath);
    if (allPaths.includes(folderPath)) {
      toast.error('A folder with this path already exists');
      return;
    }

    const newNode: TemplateItemNode = {
      id: generateTempId(),
      folderName,
      folderPath,
      isClientVisible: false,
      sortOrder: 0,
      children: [],
      isExpanded: true,
    };

    if (!parentPath) {
      setItems([...items, newNode]);
    } else {
      setItems(addChildToNode(items, parentPath, newNode));
    }

    setNewFolderName('');
    setAddingToPath(null);
  };

  const addChildToNode = (
    nodes: TemplateItemNode[],
    parentPath: string,
    newChild: TemplateItemNode
  ): TemplateItemNode[] => {
    return nodes.map((node) => {
      if (node.folderPath === parentPath) {
        return {
          ...node,
          children: [...node.children, newChild],
          isExpanded: true,
        };
      }
      if (node.children.length > 0) {
        return {
          ...node,
          children: addChildToNode(node.children, parentPath, newChild),
        };
      }
      return node;
    });
  };

  const removeFolder = (folderPath: string) => {
    setItems(removeNodeFromTree(items, folderPath));
  };

  const removeNodeFromTree = (nodes: TemplateItemNode[], pathToRemove: string): TemplateItemNode[] => {
    return nodes
      .filter((node) => node.folderPath !== pathToRemove)
      .map((node) => ({
        ...node,
        children: removeNodeFromTree(node.children, pathToRemove),
      }));
  };

  const toggleVisibility = (folderPath: string) => {
    setItems(toggleNodeVisibility(items, folderPath));
  };

  const toggleNodeVisibility = (nodes: TemplateItemNode[], pathToToggle: string): TemplateItemNode[] => {
    return nodes.map((node) => {
      if (node.folderPath === pathToToggle) {
        return { ...node, isClientVisible: !node.isClientVisible };
      }
      if (node.children.length > 0) {
        return {
          ...node,
          children: toggleNodeVisibility(node.children, pathToToggle),
        };
      }
      return node;
    });
  };

  const toggleExpand = (folderPath: string) => {
    setItems(toggleNodeExpand(items, folderPath));
  };

  const toggleNodeExpand = (nodes: TemplateItemNode[], pathToToggle: string): TemplateItemNode[] => {
    return nodes.map((node) => {
      if (node.folderPath === pathToToggle) {
        return { ...node, isExpanded: !node.isExpanded };
      }
      if (node.children.length > 0) {
        return {
          ...node,
          children: toggleNodeExpand(node.children, pathToToggle),
        };
      }
      return node;
    });
  };

  const handleDragStart = (e: React.DragEvent, folderPath: string) => {
    setDraggedItem(folderPath);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetPath: string, position: 'before' | 'after' | 'inside') => {
    e.preventDefault();
    if (!draggedItem || draggedItem === targetPath) {
      setDraggedItem(null);
      return;
    }

    // Prevent dropping a parent into its own child
    if (targetPath.startsWith(draggedItem + '/')) {
      toast.error('Cannot move folder into its own subfolder');
      setDraggedItem(null);
      return;
    }

    // Find the dragged node in the tree (preserving children)
    const findNode = (nodes: TemplateItemNode[], path: string): TemplateItemNode | null => {
      for (const node of nodes) {
        if (node.folderPath === path) return node;
        const found = findNode(node.children, path);
        if (found) return found;
      }
      return null;
    };
    const draggedNodeFull = findNode(items, draggedItem);
    if (!draggedNodeFull) {
      setDraggedItem(null);
      return;
    }

    // Remove the dragged node and its children
    let newItems = removeNodeFromTree(items, draggedItem);

    // Calculate new path based on drop position
    let newPath: string;
    if (position === 'inside') {
      const draggedName = draggedItem.split('/').filter(Boolean).pop() || 'folder';
      newPath = `${targetPath}/${draggedName}`;
    } else {
      const targetSegments = targetPath.split('/').filter(Boolean);
      const draggedName = draggedItem.split('/').filter(Boolean).pop() || 'folder';
      if (targetSegments.length === 1) {
        newPath = `/${draggedName}`;
      } else {
        const parentPath = '/' + targetSegments.slice(0, -1).join('/');
        newPath = `${parentPath}/${draggedName}`;
      }
    }

    // Check for path collision
    const existingPaths = flattenTree(newItems).map((i) => i.folderPath);
    if (existingPaths.includes(newPath)) {
      toast.error('A folder with this path already exists');
      setDraggedItem(null);
      return;
    }

    // Remap children paths from old base to new base
    const remapChildren = (children: TemplateItemNode[], oldBase: string, newBase: string): TemplateItemNode[] => {
      return children.map((child) => {
        const newChildPath = newBase + child.folderPath.slice(oldBase.length);
        return {
          ...child,
          folderPath: newChildPath,
          children: remapChildren(child.children, oldBase, newBase),
        };
      });
    };

    const newNode: TemplateItemNode = {
      id: generateTempId(),
      folderName: newPath.split('/').filter(Boolean).pop() || 'folder',
      folderPath: newPath,
      isClientVisible: draggedNodeFull.isClientVisible,
      sortOrder: 0,
      children: remapChildren(draggedNodeFull.children, draggedNodeFull.folderPath, newPath),
      isExpanded: draggedNodeFull.isExpanded,
    };

    if (position === 'inside') {
      newItems = addChildToNode(newItems, targetPath, newNode);
    } else {
      // Add at root level if dropping before/after root items
      const targetIsRoot = targetPath.split('/').filter(Boolean).length === 1;
      if (targetIsRoot) {
        const targetIndex = newItems.findIndex((n) => n.folderPath === targetPath);
        if (targetIndex !== -1) {
          const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
          newItems = [...newItems.slice(0, insertIndex), newNode, ...newItems.slice(insertIndex)];
        } else {
          newItems.push(newNode);
        }
      } else {
        // Find parent and insert there
        const parentPath = '/' + targetPath.split('/').filter(Boolean).slice(0, -1).join('/');
        newItems = insertAtSiblingPosition(newItems, parentPath, targetPath, newNode, position);
      }
    }

    setItems(newItems);
    setDraggedItem(null);
  };

  const insertAtSiblingPosition = (
    nodes: TemplateItemNode[],
    parentPath: string,
    targetPath: string,
    newNode: TemplateItemNode,
    position: 'before' | 'after'
  ): TemplateItemNode[] => {
    return nodes.map((node) => {
      if (node.folderPath === parentPath) {
        const targetIndex = node.children.findIndex((c) => c.folderPath === targetPath);
        if (targetIndex !== -1) {
          const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
          return {
            ...node,
            children: [
              ...node.children.slice(0, insertIndex),
              newNode,
              ...node.children.slice(insertIndex),
            ],
          };
        }
      }
      if (node.children.length > 0) {
        return {
          ...node,
          children: insertAtSiblingPosition(node.children, parentPath, targetPath, newNode, position),
        };
      }
      return node;
    });
  };

  const renderFolderNode = (node: TemplateItemNode, depth: number = 0) => {
    const hasChildren = node.children.length > 0;

    return (
      <div key={node.id} className="select-none">
        <div
          className={`flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted transition-colors ${
            draggedItem === node.folderPath ? 'opacity-50' : ''
          }`}
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
          draggable
          onDragStart={(e) => handleDragStart(e, node.folderPath)}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, node.folderPath, 'inside')}
        >
          <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />

          {hasChildren && (
            <button
              onClick={() => toggleExpand(node.folderPath)}
              className="p-0.5 hover:bg-muted rounded"
            >
              {node.isExpanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </button>
          )}
          {!hasChildren && <span className="w-4" />}

          <FolderOpen className="w-4 h-4 text-muted-foreground" />
          <span className="flex-1 text-sm">{node.folderName}</span>

          <button
            onClick={() => toggleVisibility(node.folderPath)}
            className={`p-1 rounded hover:bg-muted ${
              node.isClientVisible ? 'text-green-600' : 'text-muted-foreground'
            }`}
            title={node.isClientVisible ? 'Visible to clients' : 'Hidden from clients'}
          >
            {node.isClientVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>

          <Button
            id={`template-add-subfolder-${node.id}`}
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setAddingToPath(node.folderPath)}
          >
            <Plus className="w-3 h-3" />
          </Button>

          <Button
            id={`template-delete-${node.id}`}
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-destructive hover:text-destructive"
            onClick={() => removeFolder(node.folderPath)}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>

        {addingToPath === node.folderPath && (
          <div
            className="flex items-center gap-2 py-1.5 px-2"
            style={{ paddingLeft: `${(depth + 1) * 20 + 8}px` }}
          >
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name"
              className="h-7 text-sm"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') addFolder(node.folderPath);
                if (e.key === 'Escape') {
                  setAddingToPath(null);
                  setNewFolderName('');
                }
              }}
            />
            <Button id={`template-confirm-add-${node.id}`} size="sm" className="h-7" onClick={() => addFolder(node.folderPath)}>
              Add
            </Button>
            <Button
              id={`template-cancel-add-${node.id}`}
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => {
                setAddingToPath(null);
                setNewFolderName('');
              }}
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        )}

        {hasChildren && node.isExpanded && (
          <div>{node.children.map((child) => renderFolderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

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
        <h3 className="text-lg font-medium">
          {templateId ? 'Edit Template' : 'New Template'}
        </h3>
        <div className="flex items-center gap-2">
          {onCancel && (
            <Button id="template-cancel" variant="outline" onClick={onCancel} disabled={isSaving}>
              Cancel
            </Button>
          )}
          <Button id="template-save" onClick={handleSave} disabled={isSaving}>
            <Save className="w-4 h-4 mr-2" />
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Template Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Default Client Folders"
              />
            </div>

            <div className="space-y-2">
              <CustomSelect
                id="template-entity-type"
                label="Entity Type"
                options={ENTITY_TYPES}
                value={entityType}
                onValueChange={setEntityType}
                placeholder="Select entity type"
              />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Switch id="isDefault" checked={isDefault} onCheckedChange={setIsDefault} />
            <Label htmlFor="isDefault">Set as default template for this entity type</Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Folder Structure</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="border rounded-lg p-2 min-h-[200px]">
            {items.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FolderOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No folders defined yet</p>
                <p className="text-xs">Add your first folder below</p>
              </div>
            ) : (
              items.map((node) => renderFolderNode(node, 0))
            )}
          </div>

          {addingToPath === null && (
            <div className="flex items-center gap-2">
              <Input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="New root folder name"
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addFolder(null);
                }}
              />
              <Button id="template-add-folder" onClick={() => addFolder(null)} disabled={!newFolderName.trim()}>
                <Plus className="w-4 h-4 mr-2" />
                Add Root Folder
              </Button>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Drag folders to reorder. Click the eye icon to toggle client visibility.
            Click + to add subfolders.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
