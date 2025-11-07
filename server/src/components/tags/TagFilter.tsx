import React, { useState } from 'react';
import { Tag as TagIcon } from 'lucide-react';
import { Input } from 'server/src/components/ui/Input';
import * as Popover from '@radix-ui/react-popover';
import { TagGrid } from './TagGrid';
import { filterTagsByText } from 'server/src/utils/colorUtils';
import { ITag } from 'server/src/interfaces/tag.interfaces';

interface TagFilterProps {
  allTags: string[] | ITag[];
  selectedTags: string[];
  onTagSelect: (tag: string) => void;
  className?: string;
  onClear?: () => void;
}

export const TagFilter: React.FC<TagFilterProps> = ({
  allTags,
  selectedTags,
  onTagSelect,
  className = '',
  onClear
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  
  // Handle both string[] and ITag[] formats
  const tagTexts = allTags.map(tag => typeof tag === 'string' ? tag : tag.tag_text);
  const filteredTagTexts = filterTagsByText(tagTexts, searchTerm);
  
  // If we have ITag objects, filter them based on the filtered texts
  const filteredTags = typeof allTags[0] === 'string' 
    ? filteredTagTexts 
    : allTags.filter(tag => filteredTagTexts.includes((tag as ITag).tag_text)) as ITag[];

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className={`flex items-center gap-2 bg-white border border-gray-300 rounded-md p-2 hover:bg-gray-50 ${className}`}>
          <TagIcon size={16} className="text-gray-400" />
          <span className="text-gray-400">Tags Filter</span>
          {selectedTags.length > 0 && (
            <span className="bg-blue-100 text-blue-800 text-xs font-semibold px-2 py-0.5 rounded-full">
              {selectedTags.length}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
      <Popover.Content className="bg-white rounded-lg shadow-lg border border-gray-200 w-72" style={{ backgroundColor: 'white', zIndex: 9999 }}>
          <div className="p-2 bg-white">
            <div className="flex items-center gap-2 mb-2">
              <Input
                type="text"
                placeholder="Search tags"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="flex-1"
              />
              {onClear && selectedTags.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                  onClick={() => {
                    onClear();
                    setSearchTerm('');
                  }}
                >
                  Clear
                </button>
              )}
            </div>
            <TagGrid
              tags={filteredTags}
              selectedTags={selectedTags}
              onTagSelect={onTagSelect}
            />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
