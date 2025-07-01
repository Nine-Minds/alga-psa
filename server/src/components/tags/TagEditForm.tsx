'use client';

import React, { useState, useEffect } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@radix-ui/react-popover';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { generateEntityColor } from 'server/src/utils/colorUtils';
import { toast } from 'react-hot-toast';
import tinycolor from 'tinycolor2';
import { Trash2 } from 'lucide-react';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';

const PRESET_COLORS = [
  // Bright and distinct colors (Row 1)
  { background: '#FFE6E6', text: '#CC0000' }, // Bright Red
  { background: '#FFE0B3', text: '#FF6600' }, // Bright Orange
  { background: '#FFFF99', text: '#666600' }, // Bright Yellow
  { background: '#E6FFE6', text: '#008000' }, // Bright Green
  { background: '#E6F3FF', text: '#0066CC' }, // Bright Blue
  { background: '#F0E6FF', text: '#6600CC' }, // Bright Purple
  
  // Medium saturation colors (Row 2)
  { background: '#FFB3B3', text: '#990000' }, // Medium Red
  { background: '#FFCC99', text: '#CC4400' }, // Medium Orange
  { background: '#B3FFB3', text: '#004400' }, // Medium Green
  { background: '#99CCFF', text: '#003399' }, // Medium Blue
  { background: '#D9B3FF', text: '#4400AA' }, // Medium Purple
  { background: '#FFB3E6', text: '#990044' }, // Medium Pink
  
  // Professional colors (Row 3)
  { background: '#E8F5E8', text: '#2D5016' }, // Forest Green
  { background: '#E8F4FD', text: '#1B4F72' }, // Steel Blue
  { background: '#FFF8E7', text: '#8B4513' }, // Warm Brown
  { background: '#F5F5F5', text: '#333333' }, // Light Gray
  { background: '#FFE6F2', text: '#AA0055' }, // Soft Rose
  { background: '#E6F7FF', text: '#00557F' }, // Sky Blue
];

interface TagEditFormProps {
  tag: ITag;
  trigger: React.ReactNode;
  onSave: (tagId: string, updates: { text?: string; backgroundColor?: string | null; textColor?: string | null }) => Promise<void>;
  onDeleteAll?: (tagText: string, taggedType: string) => Promise<void>;
  allowTextEdit?: boolean;
  allowColorEdit?: boolean;
}

export const TagEditForm: React.FC<TagEditFormProps> = ({
  tag,
  trigger,
  onSave,
  onDeleteAll,
  allowTextEdit = true,
  allowColorEdit = true
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [tagText, setTagText] = useState(tag.tag_text);
  const [backgroundColor, setBackgroundColor] = useState<string>('');
  const [textColor, setTextColor] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteAll = async () => {
    if (!onDeleteAll || isDeleting) return;
    
    setIsDeleting(true);
    try {
      await onDeleteAll(tag.tag_text, tag.tagged_type);
      setIsOpen(false);
      setShowDeleteConfirm(false);
      toast.success(`All "${tag.tag_text}" tags deleted successfully`);
    } catch (error) {
      console.error('Failed to delete tags:', error);
      toast.error('Failed to delete tags');
    } finally {
      setIsDeleting(false);
    }
  };

  // Helper function to ensure color is in hex format
  const ensureHexColor = (color: string | null | undefined): string => {
    if (!color) return '';
    
    // If it's already hex, return it
    if (color.startsWith('#')) return color;
    
    // Try to convert HSL or other formats to hex
    const converted = tinycolor(color);
    return converted.isValid() ? converted.toHexString() : '';
  };

  // Initialize colors with actual values (custom or generated)
  useEffect(() => {
    if (!isOpen) {
      setTagText(tag.tag_text);
      const generated = generateEntityColor(tag.tag_text);
      
      // Ensure colors are in hex format
      const bgColor = ensureHexColor(tag.background_color) || generated.background;
      const txtColor = ensureHexColor(tag.text_color) || generated.text;
      
      setBackgroundColor(bgColor);
      setTextColor(txtColor);
      setIsSaving(false);
    }
  }, [isOpen, tag]);

  const handleSave = async () => {
    if (isSaving) return;
    
    const trimmedText = tagText.trim();
    if (!trimmedText) {
      toast.error('Tag text cannot be empty');
      return;
    }

    // Check what actually changed
    const updates: { text?: string; backgroundColor?: string | null; textColor?: string | null } = {};
    
    if (allowTextEdit && trimmedText !== tag.tag_text) {
      updates.text = trimmedText;
    }
    
    if (allowColorEdit) {
      // Always include colors to ensure they're saved
      updates.backgroundColor = backgroundColor;
      updates.textColor = textColor;
    }

    // If nothing changed, just close
    if (Object.keys(updates).length === 0) {
      setIsOpen(false);
      return;
    }

    setIsSaving(true);
    try {
      await onSave(tag.tag_id, updates);
      setIsOpen(false);
      toast.success('Tag updated successfully');
    } catch (error) {
      console.error('Failed to save tag changes:', error);
      if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error('Failed to save tag changes');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handlePresetClick = (preset: { background: string; text: string }) => {
    setBackgroundColor(preset.background);
    setTextColor(preset.text);
  };

  const handleReset = () => {
    const generated = generateEntityColor(tagText || tag.tag_text);
    setBackgroundColor(generated.background);
    setTextColor(generated.text);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className="w-80 p-4 bg-white border border-gray-200 rounded-lg shadow-lg z-50"
        sideOffset={5}
        onInteractOutside={(e) => {
          // Prevent closing when clicking inside the popover
          const target = e.target as HTMLElement;
          if (target.closest('[role="dialog"]')) {
            e.preventDefault();
          }
        }}
      >
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-900">Edit Tag</h3>
          
          {/* Preview */}
          <div className="flex justify-center p-3 bg-gray-50 rounded">
            <span
              className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold"
              style={{
                backgroundColor: backgroundColor,
                color: textColor,
              }}
            >
              {tagText || 'Tag Preview'}
            </span>
          </div>

          {/* Text Input */}
          {allowTextEdit && (
            <div>
              <Label className="text-xs text-gray-700 mb-1 block">
                Tag Text
              </Label>
              <Input
                type="text"
                value={tagText}
                onChange={(e) => setTagText(e.target.value)}
                placeholder="Enter tag text"
                className="w-full"
              />
            </div>
          )}

          {/* Color Options */}
          {allowColorEdit && (
            <>
              {/* Preset colors */}
              <div>
                <Label className="text-xs text-gray-700 mb-2 block">Quick Select Colors</Label>
                <div className="grid grid-cols-6 gap-2">
                  {PRESET_COLORS.map((preset, index): JSX.Element => {
                    const isSelected = backgroundColor === preset.background && textColor === preset.text;
                    return (
                      <button
                        key={index}
                        type="button"
                        className={`w-full h-8 rounded border-2 hover:border-gray-400 transition-colors ${
                          isSelected ? 'border-gray-600 ring-2 ring-gray-300' : 'border-gray-300'
                        }`}
                        style={{ backgroundColor: preset.background }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handlePresetClick(preset);
                        }}
                        title={`Background: ${preset.background}, Text: ${preset.text}`}
                      >
                        <span
                          className="text-xs font-medium"
                          style={{ color: preset.text }}
                        >
                          Aa
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom color inputs */}
              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-gray-700">Background Color</Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      value={backgroundColor}
                      onChange={(e) => setBackgroundColor(e.target.value)}
                      placeholder="#FF0000"
                      className="flex-1"
                    />
                    <input
                      type="color"
                      value={backgroundColor}
                      onChange={(e) => setBackgroundColor(e.target.value)}
                      className="w-10 h-10 rounded border border-gray-300 cursor-pointer"
                      title="Pick background color"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-xs text-gray-700">Text Color</Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      value={textColor}
                      onChange={(e) => setTextColor(e.target.value)}
                      placeholder="#FFFFFF"
                      className="flex-1"
                    />
                    <input
                      type="color"
                      value={textColor}
                      onChange={(e) => setTextColor(e.target.value)}
                      className="w-10 h-10 rounded border border-gray-300 cursor-pointer"
                      title="Pick text color"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Action buttons */}
          <div className="space-y-2 pt-2">
            {/* Delete and Reset buttons */}
            <div className="flex gap-2">
              <Button
                id={`tag-reset-${tag.tag_id}`}
                variant="outline"
                size="sm"
                onClick={handleReset}
                className="flex-1"
              >
                Reset colors
              </Button>
              {onDeleteAll && (
                <Button
                  id={`tag-delete-all-${tag.tag_id}`}
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex-1 text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  <Trash2 size={14} className="mr-1" />
                  Delete All
                </Button>
              )}
            </div>
            
            {/* Cancel and Save buttons */}
            <div className="flex gap-2">
              <Button
                id={`tag-cancel-${tag.tag_id}`}
                variant="outline"
                size="sm"
                onClick={() => setIsOpen(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                id={`tag-save-${tag.tag_id}`}
                size="sm"
                onClick={() => void handleSave()}
                disabled={isSaving}
                className="flex-1"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
      
      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDeleteAll}
        title="Delete All Tags"
        message={`Are you sure you want to delete all tags with the text "${tag.tag_text}"? This will remove this tag from all ${tag.tagged_type}s. This action cannot be undone.`}
        confirmLabel={isDeleting ? 'Deleting...' : 'Delete All'}
        cancelLabel="Cancel"
        isConfirming={isDeleting}
      />
    </Popover>
  );
};