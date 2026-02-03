'use client';

import React from 'react';
import { X, ChevronDown } from 'lucide-react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { generateEntityColor } from '../../lib/colorUtils';
import { ITag } from '@alga-psa/types';
import { TagEditForm } from './TagEditForm';

interface TagListProps {
  tags: ITag[];
  onRemoveTag?: (tagId: string) => Promise<void>;
  allowColorEdit?: boolean;
  allowTextEdit?: boolean;
  allowDeleteAll?: boolean;
  maxDisplay?: number;
  onTagUpdate?: (tagId: string, updates: { text?: string; backgroundColor?: string | null; textColor?: string | null }) => Promise<void>;
  onDeleteAll?: (tagText: string, taggedType: string) => Promise<void>;
  compact?: boolean;
}

export const TagList: React.FC<TagListProps> = ({
  tags,
  onRemoveTag,
  allowColorEdit = true,
  allowTextEdit = true,
  allowDeleteAll = true,
  maxDisplay,
  onTagUpdate,
  onDeleteAll: onDeleteAllProp,
  compact = false
}) => {
  const displayTags = maxDisplay && tags.length > maxDisplay
    ? tags.slice(0, maxDisplay)
    : tags;
  const remainingCount = maxDisplay && tags.length > maxDisplay
    ? tags.length - maxDisplay
    : 0;

  const handleTagUpdate = async (tagId: string, updates: { text?: string; backgroundColor?: string | null; textColor?: string | null }) => {
    // Use passed handler - this component is now a pure UI component
    // Tag context operations should be handled by the parent (e.g., TagManager from @alga-psa/tags)
    if (onTagUpdate) {
      await onTagUpdate(tagId, updates);
    }
  };

  const handleDeleteAll = async (tagText: string, taggedType: string) => {
    // Use passed handler - this component is now a pure UI component
    if (onDeleteAllProp) {
      await onDeleteAllProp(tagText, taggedType);
    }
  };

  return (
    <div className={`flex flex-wrap ${compact ? 'gap-0.5' : 'gap-1'}`}>
      {displayTags.map((tag): React.JSX.Element => {
        const colors = generateEntityColor(tag.tag_text);

        return (
          <span
            key={tag.tag_id}
            title={tag.tag_text}
            style={{
              backgroundColor: tag.background_color || colors.background,
              color: tag.text_color || colors.text,
              padding: compact ? '1px 4px' : '2px 6px',
              borderRadius: '9999px',
              fontSize: compact ? '0.625rem' : '0.75rem',
              fontWeight: '600',
              display: 'inline-flex',
              alignItems: 'center',
              position: 'relative',
              maxWidth: compact ? '90px' : '150px',
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
                  className={`inline-flex items-center justify-center h-full hover:opacity-70 transition-opacity flex-shrink-0 ${compact ? 'px-1 py-0.5' : 'px-2 py-1'}`}
                  style={{
                    borderRight: `1px dotted ${tag.text_color || colors.text}`,
                    marginRight: compact ? '2px' : '4px',
                  }}
                >
                  <ChevronDown size={compact ? 8 : 10} />
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
                className={`text-red-500 hover:text-red-700 flex-shrink-0 ${compact ? 'ml-0.5' : 'ml-1'}`}
                title="Remove tag"
              >
                <X size={compact ? 10 : 12} />
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
            padding: compact ? '1px 4px' : '2px 6px',
            borderRadius: '9999px',
            fontSize: compact ? '0.625rem' : '0.75rem',
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
