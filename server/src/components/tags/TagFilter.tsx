import React, { useState } from 'react';
import { Tag as TagIcon } from 'lucide-react';
import { Input } from 'server/src/components/ui/Input';
import * as Popover from '@radix-ui/react-popover';
import { TagGrid } from './TagGrid';
import { filterTagsByText } from 'server/src/utils/colorUtils';

interface TagFilterProps {
  allTags: string[];
  selectedTags: string[];
  onTagSelect: (tag: string) => void;
  className?: string;
}

export const TagFilter: React.FC<TagFilterProps> = ({
  allTags,
  selectedTags,
  onTagSelect,
  className = ''
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const filteredTags = filterTagsByText(allTags, searchTerm);

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className={`flex items-center gap-2 border border-gray-300 rounded-md p-2 hover:bg-gray-50 ${className}`}>
          <TagIcon size={16} className="text-gray-400" />
          <span className="text-gray-400">Filter by tags</span>
          {selectedTags.length > 0 && (
            <span className="bg-blue-100 text-blue-800 text-xs font-semibold px-2 py-0.5 rounded-full">
              {selectedTags.length}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Content className="bg-white rounded-lg shadow-lg border border-gray-200 w-72">
        <div className="p-2">
          <Input
            type="text"
            placeholder="Search tags"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="mb-2"
          />
          <TagGrid
            tags={filteredTags}
            selectedTags={selectedTags}
            onTagSelect={onTagSelect}
          />
        </div>
      </Popover.Content>
    </Popover.Root>
  );
};
