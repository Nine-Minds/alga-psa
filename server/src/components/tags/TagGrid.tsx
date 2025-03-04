import React from 'react';
import { generateEntityColor } from 'server/src/utils/colorUtils';

interface TagGridProps {
  tags: string[];
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
      {tags.map((tag):JSX.Element => {
        const isSelected = selectedTags.includes(tag);
        const colors = generateEntityColor(tag);
        return (
          <button
            key={tag}
            onClick={() => onTagSelect(tag)}
            className={`p-2 rounded-md text-sm text-center transition-colors ${
              isSelected ? 'ring-2 ring-primary-500' : ''
            }`}
            style={{
              backgroundColor: colors.background,
              color: colors.text,
            }}
          >
            {tag}
          </button>
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
