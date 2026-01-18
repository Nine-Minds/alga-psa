import React, { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Plus } from 'lucide-react';
import { generateEntityColor } from 'server/src/utils/colorUtils';
// import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
// import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
// import { ButtonComponent, FormFieldComponent } from '@alga-psa/ui/ui-reflection/types';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { useTags } from 'server/src/context/TagContext';

interface TagInputProps {
  id?: string; // Made optional to maintain backward compatibility
  existingTags: ITag[];
  currentTags?: ITag[];
  onAddTag: (tagText: string) => Promise<void>;
  className?: string;
  placeholder?: string;
}

export const TagInput: React.FC<TagInputProps> = ({
  id = 'tag-input',
  existingTags,
  currentTags = [],
  onAddTag,
  className = '',
  placeholder = 'New tag'
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<ITag[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Memoize current tag texts to prevent infinite loops
  const currentTagTexts = useMemo(() => {
    return currentTags.map(tag => tag.tag_text.toLowerCase());
  }, [currentTags]);

  useEffect(() => {
    if (inputValue.trim()) {
      // Filter existing tags that:
      // 1. Include the input value
      // 2. Are not already on the current entity
      const filtered = existingTags.filter(tag =>
        tag && tag.tag_text && tag.tag_text.toLowerCase().includes(inputValue.toLowerCase()) &&
        !currentTagTexts.includes(tag.tag_text.toLowerCase())
      );

      // Remove duplicates by tag_text (case-insensitive)
      const uniqueSuggestions = filtered.reduce((acc: ITag[], current) => {
        const exists = acc.find(tag => tag.tag_text.toLowerCase() === current.tag_text.toLowerCase());
        if (!exists) {
          acc.push(current);
        }
        return acc;
      }, []);

      setSuggestions(uniqueSuggestions);
    } else {
      setSuggestions([]);
    }
  }, [inputValue, existingTags, currentTagTexts]);

  // Update dropdown position when suggestions change or input is focused
  useLayoutEffect(() => {
    if (suggestions.length > 0 && inputValue.trim() && containerRef.current && isEditing) {
      const rect = containerRef.current.getBoundingClientRect();
      // Position dropdown below the input form
      setDropdownPosition({
        top: rect.bottom + 2,
        left: rect.left,
        width: Math.max(rect.width, 200) // Ensure minimum width for suggestions
      });
    }
  }, [suggestions, inputValue, isEditing]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Check if click is outside the container
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        // Also check if the dropdown exists and if click is outside it
        if (!dropdownRef.current || !dropdownRef.current.contains(event.target as Node)) {
          console.log('Click outside detected, canceling edit');
          cancelEdit();
        }
      }
    };

    if (isEditing) {
      // Use a slight delay to prevent immediate closure
      setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 100);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isEditing]);

  const handleSave = async (tagText: string = inputValue.trim()) => {
    console.log('TagInput handleSave called with:', tagText);
    if (tagText && !isSaving) {
      setIsSaving(true);
      try {
        await onAddTag(tagText);
        setInputValue('');
        setIsEditing(false);
        setSuggestions([]);
      } catch (error) {
        console.error('Error adding tag:', error);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setInputValue('');
    setSuggestions([]);
  };

  const handleKeyPress = async (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && inputValue.trim()) {
      event.preventDefault();
      await handleSave();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
    }
  };

  const [buttonPosition, setButtonPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Update button position when editing starts
  useLayoutEffect(() => {
    if (isEditing && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setButtonPosition({
        top: rect.top,
        left: rect.left
      });
    }
  }, [isEditing]);

  return (
    <>
      <div className="inline-flex items-center">
        <Button
          ref={buttonRef}
          id="tag-add-button"
          type="button"
          onClick={() => setIsEditing(true)}
          className="text-gray-500 hover:text-gray-700"
          variant="icon"
          size="icon"
          style={{ visibility: isEditing ? 'hidden' : 'visible' }}
        >
          <Plus size={16} />
        </Button>
      </div>
      
      {/* Render input form using a portal when editing */}
      {isEditing && typeof document !== 'undefined' &&
        createPortal(
          <div 
            ref={containerRef}
            className="fixed z-[100001] flex items-center"
            style={{ 
              top: `${buttonPosition.top}px`,
              left: `${buttonPosition.left}px`
            }}
          >
            <div className="flex shadow-md rounded-md bg-white border border-gray-200">
              <Input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyPress}
                className="rounded-l-md px-2 py-1 text-sm w-32 focus:ring-offset-0 focus:z-10 border-0"
                placeholder={placeholder}
                autoFocus
                autoComplete="off"
                containerClassName="m-0"
              />
              <Button
                id="tag-save-button"
                type="button"
                onClick={() => handleSave()}
                disabled={isSaving || !inputValue.trim()}
                className="rounded-r-md px-3 py-1 text-sm font-medium border-0 whitespace-nowrap"
                variant={isSaving || !inputValue.trim() ? "outline" : "default"}
                size="sm"
              >
                {isSaving ? '...' : 'Save'}
              </Button>
            </div>
          </div>,
          document.body
        )
      }
      
      {/* Render suggestions dropdown using a portal to avoid table event interference */}
      {suggestions.length > 0 && inputValue.trim() && isEditing && typeof document !== 'undefined' &&
        createPortal(
          <div 
            ref={dropdownRef}
            className="fixed z-[100000] bg-white border border-gray-200 rounded-md shadow-lg"
            style={{ 
              top: `${dropdownPosition.top}px`,
              left: `${dropdownPosition.left}px`,
              minWidth: '200px',
              maxHeight: '200px',
              overflowY: 'auto',
              pointerEvents: 'auto'
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            {suggestions.map((suggestion, index): React.JSX.Element => {
              const colors = generateEntityColor(suggestion.tag_text);
              return (
                <button
                  key={index}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center border-b border-gray-100 last:border-b-0 transition-colors"
                  onClick={(e) => {
                    console.log('Tag suggestion clicked:', suggestion.tag_text);
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onMouseDown={(e) => {
                    console.log('Tag suggestion mousedown:', suggestion.tag_text);
                    e.preventDefault();
                    e.stopPropagation();
                    // Handle the save on mousedown to prevent click outside from firing
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
          </div>,
          document.body
        )
      }
    </>
  );
};
