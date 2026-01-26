'use client';

import React, { useMemo } from 'react';
import { ChevronDown, ChevronRight, Eye } from 'lucide-react';
import { Input } from 'server/src/components/ui/Input';
import { Switch } from 'server/src/components/ui/Switch';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { DatePicker } from 'server/src/components/ui/DatePicker';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { ICustomField, ICustomFieldGroup } from 'server/src/interfaces/customField.interfaces';

interface FieldPreviewPaneProps {
  fields: ICustomField[];
  groups: ICustomFieldGroup[];
  className?: string;
}

/**
 * Live preview pane showing how custom fields will render
 * Used in settings to visualize field configuration
 */
export function FieldPreviewPane({ fields, groups, className = '' }: FieldPreviewPaneProps) {
  // Sort groups by group_order
  const sortedGroups = useMemo(() => {
    return [...groups].sort((a, b) => a.group_order - b.group_order);
  }, [groups]);

  // Group fields
  const fieldsByGroup = useMemo(() => {
    const map: Record<string, ICustomField[]> = { ungrouped: [] };

    sortedGroups.forEach(group => {
      map[group.group_id] = [];
    });

    fields
      .filter(f => f.is_active)
      .sort((a, b) => a.field_order - b.field_order)
      .forEach(field => {
        if (field.group_id && map[field.group_id]) {
          map[field.group_id].push(field);
        } else {
          map.ungrouped.push(field);
        }
      });

    return map;
  }, [fields, sortedGroups]);

  const renderFieldPreview = (field: ICustomField) => {
    return (
      <div key={field.field_id} className="mb-3">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {field.name}
          {field.is_required && <span className="text-red-500 ml-1">*</span>}
        </label>
        {field.description && (
          <p className="text-xs text-gray-500 mb-1">{field.description}</p>
        )}
        {renderFieldInput(field)}
      </div>
    );
  };

  const renderFieldInput = (field: ICustomField) => {
    switch (field.type) {
      case 'text':
        return (
          <Input
            id={`preview-${field.field_id}`}
            placeholder={`Enter ${field.name.toLowerCase()}...`}
            disabled
            className="bg-gray-50"
          />
        );
      case 'number':
        return (
          <Input
            id={`preview-${field.field_id}`}
            type="number"
            placeholder="0"
            disabled
            className="bg-gray-50"
          />
        );
      case 'date':
        return (
          <div className="bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-500">
            Click to select date...
          </div>
        );
      case 'boolean':
        return (
          <div className="flex items-center gap-2">
            <Switch id={`preview-${field.field_id}`} disabled />
            <span className="text-sm text-gray-500">Yes / No</span>
          </div>
        );
      case 'picklist':
        return (
          <div className="bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-500 flex items-center justify-between">
            <span>Select an option...</span>
            <ChevronDown className="w-4 h-4" />
          </div>
        );
      case 'multi_picklist':
        return (
          <div className="bg-gray-50 border border-gray-200 rounded-md p-2 max-h-32 overflow-y-auto">
            {field.options?.slice(0, 4).map((option, idx) => (
              <div key={idx} className="flex items-center gap-2 py-1">
                <Checkbox disabled />
                <span className="text-sm text-gray-600">{option.label}</span>
              </div>
            ))}
            {(field.options?.length || 0) > 4 && (
              <p className="text-xs text-gray-400 mt-1">
                +{(field.options?.length || 0) - 4} more options
              </p>
            )}
          </div>
        );
      default:
        return (
          <Input
            id={`preview-${field.field_id}`}
            placeholder="..."
            disabled
            className="bg-gray-50"
          />
        );
    }
  };

  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(() => {
    const collapsed = new Set<string>();
    sortedGroups.forEach(g => {
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

  const activeFields = fields.filter(f => f.is_active);

  if (activeFields.length === 0) {
    return (
      <div className={`bg-white border border-gray-200 rounded-lg p-6 ${className}`}>
        <div className="flex items-center gap-2 mb-4">
          <Eye className="w-5 h-5 text-gray-400" />
          <h3 className="font-medium text-gray-700">Preview</h3>
        </div>
        <div className="text-center py-8 text-gray-500">
          <p className="text-sm">No active fields to preview</p>
          <p className="text-xs mt-1">Create fields to see how they'll appear</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white border border-gray-200 rounded-lg p-4 ${className}`}>
      <div className="flex items-center gap-2 mb-4">
        <Eye className="w-5 h-5 text-gray-400" />
        <h3 className="font-medium text-gray-700">Preview</h3>
        <span className="text-xs text-gray-400">({activeFields.length} fields)</span>
      </div>

      <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
        {/* Ungrouped fields */}
        {fieldsByGroup.ungrouped.length > 0 && (
          <div className="space-y-3">
            {fieldsByGroup.ungrouped.map(renderFieldPreview)}
          </div>
        )}

        {/* Grouped fields */}
        {sortedGroups.map(group => {
          const groupFields = fieldsByGroup[group.group_id] || [];
          if (groupFields.length === 0) return null;

          const isCollapsed = collapsedGroups.has(group.group_id);

          return (
            <div key={group.group_id} className="border border-gray-200 rounded-lg overflow-hidden">
              <button
                className="w-full bg-gray-50 px-3 py-2 flex items-center gap-2 text-left hover:bg-gray-100 transition-colors"
                onClick={() => toggleGroup(group.group_id)}
              >
                {isCollapsed ? (
                  <ChevronRight className="w-4 h-4 text-gray-500" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                )}
                <span className="font-medium text-sm text-gray-700">{group.name}</span>
                <span className="text-xs text-gray-400">({groupFields.length})</span>
              </button>

              {!isCollapsed && (
                <div className="p-3 space-y-3">
                  {groupFields.map(renderFieldPreview)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default FieldPreviewPane;
