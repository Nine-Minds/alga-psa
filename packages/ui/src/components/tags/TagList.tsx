'use client';

import React from 'react';
import { X, ChevronDown } from 'lucide-react';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { generateEntityColor } from 'server/src/utils/colorUtils';
import { TagEditForm } from './TagEditForm';
import { useTags } from 'server/src/context/TagContext';

interface TagListProps {
  tags: ITag[];
  onRemoveTag?: (tagId: string) => Promise<void>;
  allowColorEdit?: boolean;
  allowTextEdit?: boolean;
  allowDeleteAll?: boolean;
  maxDisplay?: number;
  onTagUpdate?: (tagId: string, updates: { text?: string; backgroundColor?: string | null; textColor?: string | null }) => Promise<void>;
  onDeleteAll?: (tagText: string, taggedType: string) => Promise<void>;
}

export const TagList: React.FC<TagListProps> = ({ 
  tags, 
  onRemoveTag, 
  allowColorEdit = true, 
  allowTextEdit = true,
  allowDeleteAll = true,
  maxDisplay,
  onTagUpdate,
  onDeleteAll: onDeleteAllProp
}) => {
  const tagContext = useTags();
  const { updateTagColor, updateTagText, deleteAllTagsByText } = tagContext || {};

  const displayTags = maxDisplay && tags.length > maxDisplay
    ? tags.slice(0, maxDisplay)
    : tags;
  const remainingCount = maxDisplay && tags.length > maxDisplay
    ? tags.length - maxDisplay
    : 0;

  const handleTagUpdate = async (tagId: string, updates: { text?: string; backgroundColor?: string | null; textColor?: string | null }) => {
    // Use passed handler if available, otherwise fall back to TagContext
    if (onTagUpdate) {
      await onTagUpdate(tagId, updates);
    } else {
      // Handle text update
      if (updates.text !== undefined && updateTagText) {
        await updateTagText(tagId, updates.text);
      }
      
      // Handle color update
      if ((updates.backgroundColor !== undefined || updates.textColor !== undefined) && updateTagColor) {
        const tag = tags.find(t => t.tag_id === tagId);
        if (tag) {
          await updateTagColor(
            tagId, 
            updates.backgroundColor !== undefined ? updates.backgroundColor : (tag.background_color ?? null),
            updates.textColor !== undefined ? updates.textColor : (tag.text_color ?? null)
          );
        }
      }
    }
  };

  const handleDeleteAll = async (tagText: string, taggedType: string) => {
    // Use passed handler if available, otherwise fall back to TagContext
    if (onDeleteAllProp) {
      await onDeleteAllProp(tagText, taggedType);
    } else if (deleteAllTagsByText) {
      await deleteAllTagsByText(tagText, taggedType as any);
    }
  };

  return (
    <div className="flex flex-wrap gap-1">
      {displayTags.map((tag): React.JSX.Element => {
        const colors = generateEntityColor(tag.tag_text);

        return (
          <span
            key={tag.tag_id}
            title={tag.tag_text}
            style={{
              backgroundColor: tag.background_color || colors.background,
              color: tag.text_color || colors.text,
              padding: '2px 6px',
              borderRadius: '9999px',
              fontSize: '0.75rem',
              fontWeight: '600',
              display: 'inline-flex',
              alignItems: 'center',
              position: 'relative',
              maxWidth: '150px',
            }}
          >
            <TagEditForm
              tag={tag}
              onSave={handleTagUpdate}
              onDeleteAll={allowDeleteAll ? handleDeleteAll : undefined}
              allowTextEdit={allowTextEdit}
              allowColorEdit={allowColorEdit}
              trigger={
                <button
                  type="button"
                  className="inline-flex items-center justify-center h-full px-2 py-1 hover:opacity-70 transition-opacity flex-shrink-0"
                  style={{
                    borderRight: `1px dotted ${tag.text_color || colors.text}`,
                    marginRight: '4px',
                  }}
                >
                  <ChevronDown size={10} />
                </button>
              }
            />
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {tag.tag_text}
            </span>
            {onRemoveTag && (
              <button
                type="button"
                onClick={() => void onRemoveTag(tag.tag_id)}
                className="ml-1 text-red-500 hover:text-red-700 flex-shrink-0"
                title="Remove tag"
              >
                <X size={12} />
              </button>
            )}
          </span>
        );
      })}
      {remainingCount > 0 && (
        <span
          style={{
            backgroundColor: '#e5e7eb',
            color: '#6b7280',
            padding: '2px 6px',
            borderRadius: '9999px',
            fontSize: '0.75rem',
            fontWeight: '600',
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          +{remainingCount} more
        </span>
      )}
    </div>
  );
};
