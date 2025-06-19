'use client';

import React from 'react';
import { X, ChevronDown } from 'lucide-react';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { generateEntityColor } from 'server/src/utils/colorUtils';
import ColorPicker from 'server/src/components/ui/ColorPicker';
import { useTags } from 'server/src/context/TagContext';

interface TagListProps {
  tags: ITag[];
  onRemoveTag?: (tagId: string) => Promise<void>;
  allowColorEdit?: boolean;
  maxDisplay?: number;
}

export const TagList: React.FC<TagListProps> = ({ tags, onRemoveTag, allowColorEdit = true, maxDisplay }) => {
  const { updateTagColor } = useTags();

  const displayTags = maxDisplay && tags.length > maxDisplay
    ? tags.slice(0, maxDisplay)
    : tags;
  const remainingCount = maxDisplay && tags.length > maxDisplay
    ? tags.length - maxDisplay
    : 0;

  return (
    <div className="flex flex-wrap gap-1">
      {displayTags.map(tag => {
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
            {allowColorEdit && (
              <ColorPicker
                currentBackgroundColor={tag.background_color}
                currentTextColor={tag.text_color}
                onSave={(bg, text) => updateTagColor(tag.tag_id, bg, text)}
                trigger={
                  <button
                    className="inline-flex items-center justify-center h-full px-1 hover:opacity-70 transition-opacity"
                    style={{
                      borderRight: `1px dotted ${tag.text_color || colors.text}`,
                      marginRight: '4px'
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ChevronDown size={10} />
                  </button>
                }
              />
            )}
            {tag.tag_text}
            {onRemoveTag && (
              <button
                onClick={() => onRemoveTag(tag.tag_id)}
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
