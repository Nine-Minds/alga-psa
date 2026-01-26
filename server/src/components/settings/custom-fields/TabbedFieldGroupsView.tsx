'use client';

import React, { useState, useMemo } from 'react';
import { Plus, FolderOpen, Pencil, Trash2, ChevronDown, ChevronRight, Settings2 } from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'server/src/components/ui/Tabs';
import { DraggableFieldList } from './DraggableFieldList';
import {
  ICustomField,
  ICustomFieldGroup,
  BulkFieldOrderInput,
  CustomFieldEntityType,
} from 'server/src/interfaces/customField.interfaces';

interface TabbedFieldGroupsViewProps {
  entityType: CustomFieldEntityType;
  fields: ICustomField[];
  groups: ICustomFieldGroup[];
  onReorder: (reorderedFields: BulkFieldOrderInput[]) => Promise<void>;
  onEditField: (field: ICustomField) => void;
  onDeleteField: (field: ICustomField) => void;
  onToggleFieldActive: (field: ICustomField) => void;
  onAddField: (groupId?: string | null) => void;
  onEditGroup: (group: ICustomFieldGroup) => void;
  onDeleteGroup: (group: ICustomFieldGroup) => void;
  onAddGroup: () => void;
}

/**
 * Tabbed view of custom field groups (Halo-style)
 * Each group is displayed as a horizontal tab
 * Ungrouped fields are shown in an "Ungrouped" tab
 */
export function TabbedFieldGroupsView({
  entityType,
  fields,
  groups,
  onReorder,
  onEditField,
  onDeleteField,
  onToggleFieldActive,
  onAddField,
  onEditGroup,
  onDeleteGroup,
  onAddGroup,
}: TabbedFieldGroupsViewProps) {
  const [activeTab, setActiveTab] = useState<string>('ungrouped');

  // Sort groups by group_order
  const sortedGroups = useMemo(() => {
    return [...groups].sort((a, b) => a.group_order - b.group_order);
  }, [groups]);

  // Separate fields by group
  const ungroupedFields = useMemo(() => {
    return fields.filter(f => !f.group_id);
  }, [fields]);

  const fieldsByGroup = useMemo(() => {
    const map: Record<string, ICustomField[]> = {};
    groups.forEach(group => {
      map[group.group_id] = fields.filter(f => f.group_id === group.group_id);
    });
    return map;
  }, [fields, groups]);

  // Set initial active tab
  React.useEffect(() => {
    if (sortedGroups.length > 0 && activeTab === 'ungrouped' && ungroupedFields.length === 0) {
      setActiveTab(sortedGroups[0].group_id);
    }
  }, [sortedGroups, ungroupedFields.length, activeTab]);

  const renderGroupHeader = (group: ICustomFieldGroup) => (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <FolderOpen className="w-4 h-4 text-primary-500" />
        <span className="font-medium text-gray-700">{group.name}</span>
        {group.description && (
          <span className="text-xs text-gray-500">- {group.description}</span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button
          id={`edit-group-${group.group_id}`}
          variant="ghost"
          size="sm"
          onClick={() => onEditGroup(group)}
          className="text-gray-500 hover:text-gray-700"
        >
          <Pencil className="w-3 h-3" />
        </Button>
        <Button
          id={`delete-group-${group.group_id}`}
          variant="ghost"
          size="sm"
          onClick={() => onDeleteGroup(group)}
          className="text-gray-500 hover:text-red-600"
        >
          <Trash2 className="w-3 h-3" />
        </Button>
        <Button
          id={`add-field-to-group-${group.group_id}`}
          variant="outline"
          size="sm"
          onClick={() => onAddField(group.group_id)}
        >
          <Plus className="w-3 h-3 mr-1" />
          Add Field
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header with Add Group button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings2 className="w-5 h-5 text-gray-400" />
          <h3 className="text-sm font-medium text-gray-700">Field Groups</h3>
        </div>
        <Button
          id="add-field-group"
          variant="outline"
          size="sm"
          onClick={onAddGroup}
        >
          <FolderOpen className="w-4 h-4 mr-1" />
          Add Group
        </Button>
      </div>

      {/* Tabbed Interface */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4 flex-wrap">
          {/* Ungrouped tab (always first) */}
          {(ungroupedFields.length > 0 || sortedGroups.length === 0) && (
            <TabsTrigger value="ungrouped" className="flex items-center gap-1">
              <span>Ungrouped</span>
              <span className="text-xs text-gray-500 ml-1">({ungroupedFields.length})</span>
            </TabsTrigger>
          )}

          {/* Group tabs */}
          {sortedGroups.map((group) => (
            <TabsTrigger
              key={group.group_id}
              value={group.group_id}
              className="flex items-center gap-1"
            >
              <FolderOpen className="w-3 h-3" />
              <span>{group.name}</span>
              <span className="text-xs text-gray-500 ml-1">
                ({fieldsByGroup[group.group_id]?.length || 0})
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Ungrouped Content */}
        {(ungroupedFields.length > 0 || sortedGroups.length === 0) && (
          <TabsContent value="ungrouped" className="mt-0">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-700">Ungrouped Fields</span>
                  <span className="text-xs text-gray-500">
                    Fields without a group appear here
                  </span>
                </div>
                <Button
                  id="add-ungrouped-field"
                  variant="outline"
                  size="sm"
                  onClick={() => onAddField(null)}
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Add Field
                </Button>
              </div>

              <DraggableFieldList
                fields={fields}
                groups={groups}
                onReorder={onReorder}
                onEdit={onEditField}
                onDelete={onDeleteField}
                onToggleActive={onToggleFieldActive}
                groupId={null}
              />
            </div>
          </TabsContent>
        )}

        {/* Group Contents */}
        {sortedGroups.map((group) => (
          <TabsContent key={group.group_id} value={group.group_id} className="mt-0">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              {renderGroupHeader(group)}

              <DraggableFieldList
                fields={fields}
                groups={groups}
                onReorder={onReorder}
                onEdit={onEditField}
                onDelete={onDeleteField}
                onToggleActive={onToggleFieldActive}
                groupId={group.group_id}
              />
            </div>
          </TabsContent>
        ))}
      </Tabs>

      {/* Empty state when no groups and no ungrouped fields */}
      {sortedGroups.length === 0 && ungroupedFields.length === 0 && (
        <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-lg">
          <FolderOpen className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-700 mb-2">No Custom Fields</h3>
          <p className="text-sm text-gray-500 mb-4">
            Create groups to organize your fields, then add fields to each group.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button
              id="create-first-group"
              variant="outline"
              onClick={onAddGroup}
            >
              <FolderOpen className="w-4 h-4 mr-2" />
              Create Group
            </Button>
            <Button
              id="create-first-field"
              onClick={() => onAddField(null)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Field
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Collapsible variant for field groups (alternative to tabs)
 */
export function CollapsibleFieldGroupsView({
  entityType,
  fields,
  groups,
  onReorder,
  onEditField,
  onDeleteField,
  onToggleFieldActive,
  onAddField,
  onEditGroup,
  onDeleteGroup,
  onAddGroup,
}: TabbedFieldGroupsViewProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    const collapsed = new Set<string>();
    groups.forEach(g => {
      if (g.is_collapsed_by_default) {
        collapsed.add(g.group_id);
      }
    });
    return collapsed;
  });

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  // Sort groups by group_order
  const sortedGroups = useMemo(() => {
    return [...groups].sort((a, b) => a.group_order - b.group_order);
  }, [groups]);

  // Separate fields by group
  const ungroupedFields = useMemo(() => {
    return fields.filter(f => !f.group_id);
  }, [fields]);

  return (
    <div className="space-y-4">
      {/* Header with Add Group button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings2 className="w-5 h-5 text-gray-400" />
          <h3 className="text-sm font-medium text-gray-700">Field Groups</h3>
        </div>
        <div className="flex gap-2">
          <Button
            id="add-field-group-collapsible"
            variant="outline"
            size="sm"
            onClick={onAddGroup}
          >
            <FolderOpen className="w-4 h-4 mr-1" />
            Add Group
          </Button>
          <Button
            id="add-field-ungrouped-collapsible"
            size="sm"
            onClick={() => onAddField(null)}
          >
            <Plus className="w-4 h-4 mr-1" />
            Add Field
          </Button>
        </div>
      </div>

      {/* Ungrouped Fields */}
      {ungroupedFields.length > 0 && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-2 flex items-center justify-between">
            <span className="font-medium text-gray-700">Ungrouped Fields</span>
            <span className="text-xs text-gray-500">{ungroupedFields.length} fields</span>
          </div>
          <div className="p-4">
            <DraggableFieldList
              fields={fields}
              groups={groups}
              onReorder={onReorder}
              onEdit={onEditField}
              onDelete={onDeleteField}
              onToggleActive={onToggleFieldActive}
              groupId={null}
            />
          </div>
        </div>
      )}

      {/* Grouped Fields */}
      {sortedGroups.map((group) => {
        const isCollapsed = collapsedGroups.has(group.group_id);
        const groupFields = fields.filter(f => f.group_id === group.group_id);

        return (
          <div key={group.group_id} className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              className="w-full bg-gray-50 px-4 py-2 flex items-center justify-between hover:bg-gray-100 transition-colors"
              onClick={() => toggleGroup(group.group_id)}
            >
              <div className="flex items-center gap-2">
                {isCollapsed ? (
                  <ChevronRight className="w-4 h-4 text-gray-500" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                )}
                <FolderOpen className="w-4 h-4 text-primary-500" />
                <span className="font-medium text-gray-700">{group.name}</span>
                {group.description && (
                  <span className="text-xs text-gray-500">- {group.description}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">{groupFields.length} fields</span>
                <Button
                  id={`edit-group-collapsible-${group.group_id}`}
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditGroup(group);
                  }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <Pencil className="w-3 h-3" />
                </Button>
                <Button
                  id={`delete-group-collapsible-${group.group_id}`}
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteGroup(group);
                  }}
                  className="text-gray-500 hover:text-red-600"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </button>

            {!isCollapsed && (
              <div className="p-4">
                <div className="flex justify-end mb-3">
                  <Button
                    id={`add-field-to-group-collapsible-${group.group_id}`}
                    variant="outline"
                    size="sm"
                    onClick={() => onAddField(group.group_id)}
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Add Field
                  </Button>
                </div>
                <DraggableFieldList
                  fields={fields}
                  groups={groups}
                  onReorder={onReorder}
                  onEdit={onEditField}
                  onDelete={onDeleteField}
                  onToggleActive={onToggleFieldActive}
                  groupId={group.group_id}
                />
              </div>
            )}
          </div>
        );
      })}

      {/* Empty state */}
      {sortedGroups.length === 0 && ungroupedFields.length === 0 && (
        <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-lg">
          <FolderOpen className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-700 mb-2">No Custom Fields</h3>
          <p className="text-sm text-gray-500 mb-4">
            Create groups to organize your fields, then add fields to each group.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button
              id="create-first-group-collapsible"
              variant="outline"
              onClick={onAddGroup}
            >
              <FolderOpen className="w-4 h-4 mr-2" />
              Create Group
            </Button>
            <Button
              id="create-first-field-collapsible"
              onClick={() => onAddField(null)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Field
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default TabbedFieldGroupsView;
