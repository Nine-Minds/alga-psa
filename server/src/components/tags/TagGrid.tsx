import React from 'react';
import { generateEntityColor } from 'server/src/utils/colorUtils';
import { Button } from 'server/src/components/ui/Button';
import { ITag } from 'server/src/interfaces/tag.interfaces';

interface TagGridProps {
  tags: string[] | ITag[];
  selectedTags: string[];
  onTagSelect: (tag: string) => void;
  className?: string;
}

export const TagGrid: React.FC<TagGridProps> = ({
  tags,
  selectedTags,
  onTagSelect,
  className = ''
}) => {
  return (
    <div className={`grid grid-cols-3 gap-2 p-2 max-h-60 overflow-y-auto ${className}`}>
      {tags.map((tag, index): React.JSX.Element => {
        const tagText = typeof tag === 'string' ? tag : tag.tag_text;
        const isSelected = selectedTags.includes(tagText);
        
        // Use actual colors from tag object if available, otherwise generate
        let backgroundColor: string;
        let textColor: string;
        
        if (typeof tag !== 'string' && tag.background_color && tag.text_color) {
          backgroundColor = tag.background_color;
          textColor = tag.text_color;
        } else {
          const colors = generateEntityColor(tagText);
          backgroundColor = colors.background;
          textColor = colors.text;
        }
        
        return (
          <Button
            key={tagText}
            id={`tag-${index}`}
            label={tagText}
            title={tagText}
            onClick={() => onTagSelect(tagText)}
            className={`p-1 rounded-md text-xs text-center transition-colors overflow-hidden min-w-0 truncate ${
              isSelected ? 'ring-2 ring-primary-500 px-1' : ''
            }`}
            style={{
              backgroundColor,
              color: textColor,
              display: 'block',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            }}
            variant="ghost"
          >
            {tagText}
          </Button>
        );
      })}
      {tags.length === 0 && (
        <div className="col-span-3 text-center py-4 text-gray-500 text-sm">
          No tags found
        </div>
      )}
    </div>
  );
};
