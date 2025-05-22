import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus } from 'lucide-react';
import { generateEntityColor } from '../../utils/colorUtils';
import { useAutomationIdAndRegister } from '../../types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';
import { ButtonComponent, FormFieldComponent } from '../../types/ui-reflection/types';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';

interface TagInputProps {
  id?: string; // Made optional to maintain backward compatibility
  existingTags: string[];
  onAddTag: (tagText: string) => Promise<void>;
  className?: string;
  placeholder?: string;
}

export const TagInput: React.FC<TagInputProps> = ({
  id = 'tag-input',
  existingTags,
  onAddTag,
  className = '',
  placeholder = 'New tag'
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (inputValue.trim()) {
      // Filter existing tags that include the input value
      const filtered = existingTags.filter(tag => 
        tag.toLowerCase().includes(inputValue.toLowerCase())
      );
      setSuggestions(filtered);
    } else {
      setSuggestions([]);
    }
  }, [inputValue, existingTags]);

  // Update dropdown position when suggestions change or input is focused
  useLayoutEffect(() => {
    if (suggestions.length > 0 && inputValue.trim() && inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width
      });
    }
  }, [suggestions, inputValue]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        cancelEdit();
      }
    };

    if (isEditing) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isEditing]);

  const handleSave = async (tagText: string = inputValue.trim()) => {
    console.log('TagInput.handleSave called with:', tagText);
    console.log('TagInput.handleSave - isSaving:', isSaving);
    console.log('TagInput.handleSave - tagText exists:', !!tagText);
    
    if (tagText && !isSaving) {
      setIsSaving(true);
      console.log('TagInput.handleSave - calling onAddTag with:', tagText);
      try {
        await onAddTag(tagText);
        console.log('TagInput.handleSave - onAddTag completed successfully');
        setInputValue('');
        setIsEditing(false);
      } catch (error) {
        console.error('TagInput.handleSave - error in onAddTag:', error);
      } finally {
        setIsSaving(false);
      }
    } else {
      console.log('TagInput.handleSave - skipped because tagText is empty or isSaving is true');
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

  return (
    <>
      <ReflectionContainer id={id} label="Tag Input">
        {!isEditing ? (
          <Button
            id="tag-add-button"
            onClick={() => setIsEditing(true)}
            className="text-gray-500 hover:text-gray-700"
            variant="icon"
            size="icon"
          >
            <Plus size={16} />
          </Button>
        ) : (
          <div ref={containerRef} className={`relative flex items-center ${className}`}>
            <div className="relative flex">
              <Input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyPress}
                className="rounded-l-md px-2 py-1 text-sm w-24 focus:ring-offset-0 focus:z-10"
                placeholder={placeholder}
                autoFocus
                autoComplete="off"
                containerClassName="m-0.5"
              />
              <Button
                id="tag-save-button"
                onClick={() => handleSave()}
                disabled={isSaving || !inputValue.trim()}
                className="rounded-r-md px-3 py-1 text-sm font-medium ml-px"
                variant={isSaving || !inputValue.trim() ? "outline" : "default"}
                size="sm"
              >
                {isSaving ? '...' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </ReflectionContainer>
      
      {/* Render suggestions dropdown using a portal to avoid table event interference */}
      {suggestions.length > 0 && inputValue.trim() && isEditing && typeof document !== 'undefined' &&
        createPortal(
          <div 
            className="fixed z-[10000] w-48 bg-white border border-gray-200 rounded-md shadow-lg"
            style={{ 
              top: `${dropdownPosition.top}px`,
              left: `${dropdownPosition.left}px`,
              maxHeight: '200px',
              overflowY: 'auto'
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
            {suggestions.map((suggestion, index): JSX.Element => {
              const colors = generateEntityColor(suggestion);
              return (
                <button
                  key={index}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center border-b border-gray-100 last:border-b-0 transition-colors"
                  onClick={(e) => {
                    console.log('TagInput suggestion clicked:', suggestion);
                    e.preventDefault();
                    e.stopPropagation();
                    handleSave(suggestion);
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  <span
                    className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold"
                    style={{
                      backgroundColor: colors.background,
                      color: colors.text
                    }}
                  >
                    {suggestion}
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
