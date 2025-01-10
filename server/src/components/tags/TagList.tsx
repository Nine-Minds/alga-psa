import React, { JSXElementConstructor } from 'react';
import { X } from 'lucide-react';
import { ITag } from '../../interfaces/tag.interfaces';
import { generateEntityColor } from '../../utils/colorUtils';
import { useAutomationIdAndRegister } from '../../types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';
import { ButtonComponent, ContainerComponent } from '../../types/ui-reflection/types';

interface TagListProps {
  id?: string; // Made optional to maintain backward compatibility
  tags: ITag[];
  onRemoveTag?: (tagId: string) => Promise<void>;
  className?: string;
}

export const TagList: React.FC<TagListProps> = ({ 
  id = 'tag-list',
  tags, 
  onRemoveTag,
  className = ''
}) => {
  return (
    <ReflectionContainer id={id} label="Tag List">
      <div className={`flex flex-wrap gap-1 ${className}`}>
        {tags.map((tag):JSX.Element => {
          const colors = generateEntityColor(tag.tag_text);
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
              }}
            >
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
      </div>
    </ReflectionContainer>
  );
};
