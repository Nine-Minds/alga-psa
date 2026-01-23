// @ts-nocheck
// TODO: PendingTag requires isNew property
"use client";

import React, { useMemo, useRef, useEffect, useState } from 'react';
import { filterTagsByText } from '@alga-psa/ui';
import type { ITag, PendingTag, TaggedEntityType } from '@alga-psa/types';
import { X, Plus } from 'lucide-react';
import { getAllTags } from '../actions';
import { useTags } from '../context/TagContext';

interface QuickAddTagPickerProps {
  id?: string;
  entityType: TaggedEntityType;
  pendingTags: PendingTag[];
  onPendingTagsChange: (tags: PendingTag[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function QuickAddTagPicker({
  id,
  entityType,
  pendingTags,
  onPendingTagsChange,
  disabled = false,
  placeholder = 'Add tags...',
}: QuickAddTagPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const tagContext = useTags();
  const [localAllTags, setLocalAllTags] = useState<ITag[]>([]);

  const allTags = tagContext?.tags ?? localAllTags;

  useEffect(() => {
    if (tagContext?.tags) {
      return;
    }

    let canceled = false;
    (async () => {
      try {
        const fetchedTags = await getAllTags();
        if (!canceled) {
          setLocalAllTags(fetchedTags);
        }
      } catch {
        if (!canceled) {
          setLocalAllTags([]);
        }
      }
    })();

    return () => {
      canceled = true;
    };
  }, [tagContext?.tags]);

  const availableTags = useMemo(() => {
    return allTags.filter((t) => t.tagged_type === entityType);
  }, [allTags, entityType]);

  const filteredAvailableTags = useMemo(() => {
    return filterTagsByText(availableTags, searchQuery).filter(
      (tag) => !pendingTags.some((st) => st.tag_text === tag.tag_text)
    );
  }, [availableTags, searchQuery, pendingTags]);

  const handleToggleTag = (tagText: string) => {
    const existingIndex = pendingTags.findIndex((t) => t.tag_text === tagText);
    if (existingIndex > -1) {
      onPendingTagsChange(pendingTags.filter((_, i) => i !== existingIndex));
    } else {
      const tagDef = availableTags.find(t => t.tag_text === tagText);
      onPendingTagsChange([...pendingTags, {
        tag_text: tagText,
        background_color: tagDef?.background_color,
        text_color: tagDef?.text_color,
      }]);
    }
    setSearchQuery('');
  };

  const handleAddNewTag = () => {
    if (searchQuery.trim() && !pendingTags.some(t => t.tag_text === searchQuery.trim())) {
      onPendingTagsChange([...pendingTags, { tag_text: searchQuery.trim() }]);
      setSearchQuery('');
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={containerRef} data-automation-id={id}>
      <div
        className="flex flex-wrap gap-2 p-2 border rounded-md focus-within:ring-2 focus-within:ring-blue-500"
        aria-disabled={disabled}
      >
        {pendingTags.map((tag) => (
          <span
            key={tag.tag_text}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium"
            style={{ backgroundColor: tag.background_color || '#e5e7eb', color: tag.text_color || '#374151' }}
          >
            {tag.tag_text}
            <button
              onClick={() => handleToggleTag(tag.tag_text)}
              className="hover:bg-black/10 rounded-full"
              disabled={disabled}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          className="flex-1 min-w-[120px] outline-none bg-transparent text-sm"
          placeholder={pendingTags.length === 0 ? placeholder : ''}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => !disabled && setShowDropdown(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAddNewTag();
            }
          }}
          disabled={disabled}
        />
      </div>

      {showDropdown && (searchQuery || filteredAvailableTags.length > 0) && (
        <div className="absolute top-full left-0 right-0 mt-1 p-2 bg-white border rounded-md shadow-lg z-50 max-h-[200px] overflow-y-auto">
          {filteredAvailableTags.length > 0 && (
            <div className="mb-2">
              <p className="text-[10px] uppercase font-bold text-gray-400 px-2 mb-1">Existing Tags</p>
              <div className="space-y-1">
                {filteredAvailableTags.map(tag => (
                  <button
                    key={tag.tag_id}
                    onClick={() => handleToggleTag(tag.tag_text)}
                    className="w-full text-left px-2 py-1.5 text-sm hover:bg-gray-100 rounded flex items-center justify-between"
                  >
                    <span>{tag.tag_text}</span>
                    <Plus className="h-3 w-3 text-gray-400" />
                  </button>
                ))}
              </div>
            </div>
          )}
          {searchQuery && !availableTags.some(t => t.tag_text.toLowerCase() === searchQuery.toLowerCase().trim()) && (
            <div>
              <p className="text-[10px] uppercase font-bold text-gray-400 px-2 mb-1">New Tag</p>
              <button
                onClick={handleAddNewTag}
                className="w-full text-left px-2 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded flex items-center gap-2"
                disabled={disabled}
              >
                <Plus className="h-3 w-3" />
                <span>Add "{searchQuery}"</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
