'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { Plus } from 'lucide-react';
import { ITag } from '@alga-psa/types';
import { generateEntityColor } from '../../lib/colorUtils';

interface TagInputInlineProps {
  id?: string;
  existingTags: ITag[];
  currentTags: ITag[];
  onAddTag: (tagText: string) => Promise<void>;
  placeholder?: string;
  className?: string;
}

export const TagInputInline: React.FC<TagInputInlineProps> = ({
  id = 'tag-input-inline',
  existingTags,
  currentTags,
  onAddTag,
  placeholder = 'Add tag...',
  className = ''
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setInputValue('');
    }
  };

  const handleSave = async (tagText?: string) => {
    const textToSave = tagText || inputValue.trim();
    console.log('TagInputInline handleSave called with:', textToSave);
    if (!textToSave || isSaving) return;

    setIsSaving(true);
    try {
      await onAddTag(textToSave);
      setInputValue('');
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to add tag:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleBlur = () => {
    if (!inputValue.trim()) {
      setIsEditing(false);
    }
  };

  // Get suggestions for existing tags not already on this entity
  // Deduplicate by tag_text to avoid showing the same tag multiple times
  const uniqueTagTexts = new Set<string>();
  const suggestions = existingTags
    .filter(tag => {
      const tagTextLower = tag.tag_text.toLowerCase();
      const inputLower = inputValue.toLowerCase();
      
      // Check if tag matches input and isn't already on this entity
      if (!tagTextLower.includes(inputLower) || 
          currentTags.some(ct => ct.tag_text.toLowerCase() === tagTextLower)) {
        return false;
      }
      
      // Check if we've already seen this tag text
      if (uniqueTagTexts.has(tagTextLower)) {
        return false;
      }
      
      uniqueTagTexts.add(tagTextLower);
      return true;
    })
    .slice(0, 5);

  if (!isEditing) {
    return (
      <Button
        id={`${id}-button`}
        type="button"
        onClick={() => setIsEditing(true)}
        className="text-gray-500 hover:text-gray-700"
        variant="icon"
        size="icon"
      >
        <Plus size={16} />
      </Button>
    );
  }

  return (
    <div className={`inline-flex flex-col ${className}`}>
      <div className="flex shadow-sm rounded-md bg-white border border-gray-200">
        <Input
          ref={inputRef}
          id={`${id}-input`}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyPress}
          onBlur={handleBlur}
          className="rounded-l-md px-2 py-1 text-sm w-32 border-0"
          placeholder={placeholder}
          autoComplete="off"
          containerClassName="m-0"
        />
        <Button
          id={`${id}-save`}
          type="button"
          onClick={() => handleSave()}
          disabled={isSaving || !inputValue.trim()}
          className="rounded-r-md px-3 py-1 text-sm font-medium border-0"
          variant={isSaving || !inputValue.trim() ? "outline" : "default"}
          size="sm"
        >
          {isSaving ? '...' : 'Save'}
        </Button>
      </div>
      
      {/* Inline suggestions dropdown */}
      {suggestions.length > 0 && inputValue.trim() && (
        <div className="mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-40 overflow-y-auto">
          {suggestions.map((suggestion, index) => {
            const colors = generateEntityColor(suggestion.tag_text);
            return (
              <button
                key={index}
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center"
                onMouseDown={(e) => {
                  console.log('TagInputInline suggestion clicked:', suggestion.tag_text);
                  e.preventDefault();
                  handleSave(suggestion.tag_text);
                }}
              >
                <span
                  className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold"
                  style={{
                    backgroundColor: suggestion.background_color || colors.background,
                    color: suggestion.text_color || colors.text
                  }}
                >
                  {suggestion.tag_text}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};