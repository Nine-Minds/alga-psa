"use client";

import { useState } from 'react';
import { Tag as TagIcon } from 'lucide-react';
import { Input } from '@alga-psa/ui/components/Input';
import * as Popover from '@radix-ui/react-popover';
import { TagGrid } from './TagGrid';
import { filterTagsByText } from '../../lib/utils';
import { ITag } from '@alga-psa/types';
import Spinner from '@alga-psa/ui/components/Spinner';
import { Button } from '../Button';

interface TagFilterProps {
  tags: ITag[];
  selectedTags: string[];
  onToggleTag: (tagText: string) => void;
  onClearTags: () => void;
  placeholder?: string;
}

export function TagFilter({
  tags,
  selectedTags,
  onToggleTag,
  onClearTags,
  placeholder = 'Filter by tags...',
}: TagFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredTags = filterTagsByText(tags, searchQuery);

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger asChild>
        <Button id="tag-filter-trigger" variant="outline" className="h-9 gap-2">
          <TagIcon className="h-4 w-4" />
          <span>{selectedTags.length > 0 ? `${selectedTags.length} selected` : 'Filter'}</span>
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="w-[300px] p-4 bg-white rounded-lg shadow-lg border border-gray-200 z-50"
          sideOffset={5}
        >
          <div className="space-y-4">
            <Input
              placeholder={placeholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            <div className="max-h-[200px] overflow-y-auto">
              <TagGrid
                tags={filteredTags}
                selectedTags={selectedTags}
                onTagSelect={onToggleTag}
              />
            </div>
            {selectedTags.length > 0 && (
              <div className="pt-2 border-t flex justify-end">
                <Button id="tag-filter-clear" variant="ghost" size="sm" onClick={onClearTags}>
                  Clear all
                </Button>
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}