import React, { JSXElementConstructor } from 'react';
import { X, ChevronRight } from 'lucide-react';
import { ITag } from '../../interfaces/tag.interfaces';
import { generateEntityColor } from '../../utils/colorUtils';
import { useAutomationIdAndRegister } from '../../types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';
import { ButtonComponent, ContainerComponent } from '../../types/ui-reflection/types';
import ColorPicker from '../ui/ColorPicker';
import { updateTagColor } from '../../lib/actions/tagActions';

interface TagListProps {
  id?: string; // Made optional to maintain backward compatibility
  tags: ITag[];
  onRemoveTag?: (tagId: string) => Promise<void>;
  onColorUpdate?: (tagId: string, backgroundColor: string | null, textColor: string | null) => Promise<void>;
  className?: string;
  maxDisplay?: number;
  allowColorEdit?: boolean;
}

export const TagList: React.FC<TagListProps> = ({ 
  id = 'tag-list',
  tags, 
  onRemoveTag,
  onColorUpdate,
  className = '',
  maxDisplay,
  allowColorEdit = false
}) => {
  const displayTags = maxDisplay && tags.length > maxDisplay 
    ? tags.slice(0, maxDisplay) 
    : tags;
  const remainingCount = maxDisplay && tags.length > maxDisplay 
    ? tags.length - maxDisplay 
    : 0;

  const handleColorUpdate = async (tagId: string, backgroundColor: string | null, textColor: string | null) => {
    if (onColorUpdate) {
      await onColorUpdate(tagId, backgroundColor, textColor);
    } else {
      // Default implementation using the server action
      await updateTagColor(tagId, backgroundColor, textColor);
    }
  };

  return (
    <ReflectionContainer id={id} label="Tag List">
      <div className={`flex flex-wrap gap-1 ${className}`}>
        {displayTags.map((tag):JSX.Element => {
          const colors = generateEntityColor(tag);
          return (
            <span
              key={tag.tag_id}
              style={{
                backgroundColor: colors.background,
                color: colors.text,
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
                <>
                  <ColorPicker
                    currentBackgroundColor={tag.background_color}
                    currentTextColor={tag.text_color}
                    onSave={(bg, text) => handleColorUpdate(tag.tag_id, bg, text)}
                    trigger={
                      <button
                        className="inline-flex items-center justify-center h-full px-1 hover:opacity-70 transition-opacity"
                        style={{
                          borderRight: `1px dotted ${colors.text}`,
                          marginRight: '4px'
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ChevronRight size={10} />
                      </button>
                    }
                  />
                </>
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
    </ReflectionContainer>
  );
};
