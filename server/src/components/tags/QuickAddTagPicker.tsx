'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { Plus, X } from 'lucide-react';
import { TaggedEntityType, ITag, PendingTag } from 'server/src/interfaces/tag.interfaces';
import { generateEntityColor } from 'server/src/utils/colorUtils';
import { findAllTagsByType } from 'server/src/lib/actions/tagActions';
import { Label } from '@alga-psa/ui/components/Label';

interface QuickAddTagPickerProps {
  id?: string;
  entityType: TaggedEntityType;
  pendingTags: PendingTag[];
  onPendingTagsChange: (tags: PendingTag[]) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  label?: string;
}

/**
 * A tag picker component for quick add forms where the entity doesn't exist yet.
 * Collects tags as "pending" items that will be created after the entity is created.
 * Does NOT call createTag() - parent component handles that after entity creation.
 */
export const QuickAddTagPicker: React.FC<QuickAddTagPickerProps> = ({
  id = 'quick-add-tag-picker',
  entityType,
  pendingTags,
  onPendingTagsChange,
  placeholder = 'Add tag...',
  className = '',
  disabled = false,
  label = 'Tags'
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [existingTags, setExistingTags] = useState<ITag[]>([]);
  const [isLoadingTags, setIsLoadingTags] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch existing tags for this entity type when component mounts
  useEffect(() => {
    const fetchTags = async () => {
      if (isLoadingTags) return;
      setIsLoadingTags(true);
      try {
        const tags = await findAllTagsByType(entityType);
        setExistingTags(tags);
      } catch (error) {
        console.error('Failed to load existing tags:', error);
      } finally {
        setIsLoadingTags(false);
      }
    };
    fetchTags();
  }, [entityType]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setInputValue('');
    }
  };

  const handleAddTag = (tagText?: string) => {
    const textToAdd = (tagText || inputValue).trim();
    if (!textToAdd) return;

    // Check if this tag is already in pending list (case-insensitive)
    const alreadyPending = pendingTags.some(
      pt => pt.tag_text.toLowerCase() === textToAdd.toLowerCase()
    );
    if (alreadyPending) {
      setInputValue('');
      setIsEditing(false);
      return;
    }

    // Check if this tag exists in the existing tags
    const existingTag = existingTags.find(
      t => t.tag_text.toLowerCase() === textToAdd.toLowerCase()
    );

    let newPendingTag: PendingTag;
    if (existingTag) {
      newPendingTag = {
        tag_text: existingTag.tag_text, // Use exact casing from existing tag
        tag_id: existingTag.tag_id,
        background_color: existingTag.background_color,
        text_color: existingTag.text_color,
        isNew: false
      };
    } else {
      const colors = generateEntityColor(textToAdd);
      newPendingTag = {
        tag_text: textToAdd,
        isNew: true,
        background_color: colors.background,
        text_color: colors.text
      };
    }

    onPendingTagsChange([...pendingTags, newPendingTag]);
    setInputValue('');
    setIsEditing(false);
  };

  const handleRemoveTag = (index: number) => {
    const newTags = [...pendingTags];
    newTags.splice(index, 1);
    onPendingTagsChange(newTags);
  };

  const handleBlur = () => {
    // Small delay to allow clicking on suggestions
    setTimeout(() => {
      if (!inputValue.trim()) {
        setIsEditing(false);
      }
    }, 150);
  };

  // Get suggestions for existing tags not already pending
  // Deduplicate by tag_text to avoid showing the same tag multiple times
  const uniqueTagTexts = new Set<string>();
  const suggestions = existingTags
    .filter(tag => {
      const tagTextLower = tag.tag_text.toLowerCase();
      const inputLower = inputValue.toLowerCase();

      // Check if tag matches input and isn't already pending
      if (!tagTextLower.includes(inputLower) ||
          pendingTags.some(pt => pt.tag_text.toLowerCase() === tagTextLower)) {
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

  return (
    <div className={`space-y-2 ${className}`} id={id}>
      {label && (
        <Label className="block text-sm font-medium text-gray-700">{label}</Label>
      )}

      {/* Display pending tags */}
      <div className="flex flex-wrap gap-2 items-center">
        {pendingTags.map((tag, index) => {
          const colors = tag.background_color && tag.text_color
            ? { background: tag.background_color, text: tag.text_color }
            : generateEntityColor(tag.tag_text);

          return (
            <span
              key={`${tag.tag_text}-${index}`}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold"
              style={{
                backgroundColor: colors.background,
                color: colors.text
              }}
            >
              {tag.tag_text}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => handleRemoveTag(index)}
                  className="hover:opacity-70 focus:outline-none"
                  aria-label={`Remove tag ${tag.tag_text}`}
                >
                  <X size={12} />
                </button>
              )}
            </span>
          );
        })}

        {/* Add tag button / input */}
        {!isEditing ? (
          <Button
            id={`${id}-add-button`}
            type="button"
            onClick={() => !disabled && setIsEditing(true)}
            className="text-gray-500 hover:text-gray-700"
            variant="icon"
            size="icon"
            disabled={disabled}
          >
            <Plus size={16} />
          </Button>
        ) : (
          <div className="inline-flex flex-col">
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
                disabled={disabled}
              />
              <Button
                id={`${id}-add`}
                type="button"
                onClick={() => handleAddTag()}
                disabled={disabled || !inputValue.trim()}
                className="rounded-r-md px-3 py-1 text-sm font-medium border-0"
                variant={!inputValue.trim() ? "outline" : "default"}
                size="sm"
              >
                Add
              </Button>
            </div>

            {/* Inline suggestions dropdown */}
            {suggestions.length > 0 && inputValue.trim() && (
              <div className="mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-40 overflow-y-auto z-10">
                {suggestions.map((suggestion, index) => {
                  const colors = suggestion.background_color && suggestion.text_color
                    ? { background: suggestion.background_color, text: suggestion.text_color }
                    : generateEntityColor(suggestion.tag_text);
                  return (
                    <button
                      key={index}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleAddTag(suggestion.tag_text);
                      }}
                    >
                      <span
                        className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold"
                        style={{
                          backgroundColor: colors.background,
                          color: colors.text
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
        )}
      </div>
    </div>
  );
};
