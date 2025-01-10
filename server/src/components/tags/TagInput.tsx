import React, { useState, useEffect, useRef } from 'react';
import { Plus } from 'lucide-react';
import { generateEntityColor } from '../../utils/colorUtils';
import { useAutomationIdAndRegister } from '../../types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';
import { ButtonComponent, FormFieldComponent } from '../../types/ui-reflection/types';

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
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (inputValue.trim()) {
      const filtered = existingTags.filter(tag => 
        tag.toLowerCase().includes(inputValue.toLowerCase())
      );
      setSuggestions(filtered);
    } else {
      setSuggestions([]);
    }
  }, [inputValue, existingTags]);

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
    if (tagText && !isSaving) {
      setIsSaving(true);
      try {
        await onAddTag(tagText);
        setInputValue('');
        setIsEditing(false);
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

  return (
    <ReflectionContainer id={id} label="Tag Input">
      {!isEditing ? (
        <button
          onClick={() => setIsEditing(true)}
          className="text-gray-500 hover:text-gray-700"
        >
          <Plus size={16} />
        </button>
      ) : (
        <div ref={containerRef} className={`relative flex items-center gap-1 ${className}`}>
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyPress}
            className="border border-gray-300 rounded-l-md px-2 py-1 text-sm w-24"
            placeholder={placeholder}
            autoFocus
          />
          <button
            onClick={() => handleSave()}
            disabled={isSaving || !inputValue.trim()}
            className={`border border-l-0 rounded-r-md px-3 py-1 text-sm font-medium transition-colors ${
              isSaving || !inputValue.trim()
                ? 'bg-gray-100 text-gray-400 border-gray-300 cursor-not-allowed'
                : 'bg-primary-500 hover:bg-primary-600 text-white border-primary-500'
            }`}
          >
            {isSaving ? '...' : 'Save'}
          </button>
          {suggestions.length > 0 && (
            <div className="absolute z-10 mt-1 w-48 bg-white border border-gray-200 rounded-md shadow-lg top-full">
              {suggestions.map((suggestion, index): JSX.Element => {
                const colors = generateEntityColor(suggestion);
                return (
                  <button
                    key={index}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center gap-2"
                    onClick={() => handleSave(suggestion)}
                  >
                    <span
                      className="inline-block w-3 h-3 rounded-full"
                      style={{ backgroundColor: colors.background }}
                    />
                    {suggestion}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </ReflectionContainer>
  );
};
