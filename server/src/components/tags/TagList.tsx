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
  maxDisplay?: number;
}

export const TagList: React.FC<TagListProps> = ({ 
  tags, 
  onRemoveTag, 
  allowColorEdit = true, 
  allowTextEdit = true,
  maxDisplay 
}) => {
  const { updateTagColor, updateTagText, deleteAllTagsByText } = useTags();

  const displayTags = maxDisplay && tags.length > maxDisplay
    ? tags.slice(0, maxDisplay)
    : tags;
  const remainingCount = maxDisplay && tags.length > maxDisplay
    ? tags.length - maxDisplay
    : 0;

  const handleTagUpdate = async (tagId: string, updates: { text?: string; backgroundColor?: string | null; textColor?: string | null }) => {
    // Handle text update
    if (updates.text !== undefined) {
      await updateTagText(tagId, updates.text);
    }
    
    // Handle color update
    if (updates.backgroundColor !== undefined || updates.textColor !== undefined) {
      const tag = tags.find(t => t.tag_id === tagId);
      if (tag) {
        await updateTagColor(
          tagId, 
          updates.backgroundColor !== undefined ? updates.backgroundColor : (tag.background_color ?? null),
          updates.textColor !== undefined ? updates.textColor : (tag.text_color ?? null)
        );
      }
    }
  };

  const handleDeleteAll = async (tagText: string, taggedType: string) => {
    await deleteAllTagsByText(tagText, taggedType as any);
  };

  return (
    <div className="flex flex-wrap gap-1">
      {displayTags.map((tag): JSX.Element => {
        const colors = generateEntityColor(tag.tag_text);

        return (
          <span
            key={tag.tag_id}
            style={{
              backgroundColor: tag.background_color || colors.background,
              color: tag.text_color || colors.text,
              padding: '2px 6px',
              borderRadius: '9999px',
              fontSize: '0.75rem',
              fontWeight: '600',
              display: 'inline-flex',
              alignItems: 'center',
              position: 'relative'
            }}
          >
            {(allowColorEdit || allowTextEdit) && (
              <TagEditForm
                tag={tag}
                onSave={handleTagUpdate}
                onDeleteAll={handleDeleteAll}
                allowTextEdit={allowTextEdit}
                allowColorEdit={allowColorEdit}
                trigger={
                  <button
                    className="inline-flex items-center justify-center h-full px-2 py-1 hover:opacity-70 transition-opacity cursor-pointer"
                    style={{
                      borderRight: `1px dotted ${tag.text_color || colors.text}`,
                      marginRight: '4px',
                      minWidth: '20px'
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ChevronDown size={12} />
                  </button>
                }
              />
            )}
            {tag.tag_text}
            {onRemoveTag && (
              <button
                onClick={() => void onRemoveTag(tag.tag_id)}
                className="ml-1 text-red-500 hover:text-red-700"
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
