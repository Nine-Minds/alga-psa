'use client';

import React, { useState, useEffect } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@radix-ui/react-popover';
import { Button } from './Button';
import { Input } from './Input';
import { Label } from './Label';

interface ColorPickerProps {
  currentBackgroundColor?: string | null;
  currentTextColor?: string | null;
  onSave: (backgroundColor: string | null, textColor: string | null) => void;
  trigger: React.ReactNode;
  showTextColor?: boolean; // Make text color optional
  previewType?: 'tag' | 'circle'; // Choose preview style
  colorMode?: 'tag' | 'solid'; // 'tag' for pastel bg+text pairs, 'solid' for saturated single colors
}

// Pastel colors with text pairs - good for tags/badges
const TAG_PRESET_COLORS = [
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
];

// Saturated solid colors - good for status columns, indicators, kanban boards
// Export just the color values for external use (e.g., random selection)
export const SOLID_COLORS = [
  '#6B7280', // Gray
  '#3B82F6', // Blue
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#F97316', // Orange
  '#84CC16', // Lime
  '#14B8A6', // Teal
  '#A855F7', // Violet
];

const SOLID_PRESET_COLORS = [
  { background: '#6B7280', text: '#FFFFFF' }, // Gray
  { background: '#3B82F6', text: '#FFFFFF' }, // Blue
  { background: '#10B981', text: '#FFFFFF' }, // Emerald
  { background: '#F59E0B', text: '#FFFFFF' }, // Amber
  { background: '#EF4444', text: '#FFFFFF' }, // Red
  { background: '#8B5CF6', text: '#FFFFFF' }, // Purple
  { background: '#EC4899', text: '#FFFFFF' }, // Pink
  { background: '#06B6D4', text: '#FFFFFF' }, // Cyan
  { background: '#F97316', text: '#FFFFFF' }, // Orange
  { background: '#84CC16', text: '#FFFFFF' }, // Lime
  { background: '#14B8A6', text: '#FFFFFF' }, // Teal
  { background: '#A855F7', text: '#FFFFFF' }, // Violet
];

const ColorPicker = ({
  currentBackgroundColor,
  currentTextColor,
  onSave,
  trigger,
  showTextColor = true,
  previewType = 'tag',
  colorMode = 'tag',
}: ColorPickerProps) => {
  // Select preset colors based on mode
  const PRESET_COLORS = colorMode === 'solid' ? SOLID_PRESET_COLORS : TAG_PRESET_COLORS;
  const [isOpen, setIsOpen] = useState(false);
  const [backgroundColor, setBackgroundColor] = useState(currentBackgroundColor || '');
  const [textColor, setTextColor] = useState(currentTextColor || '');
  const [backgroundError, setBackgroundError] = useState('');
  const [textError, setTextError] = useState('');

  useEffect(() => {
    setBackgroundColor(currentBackgroundColor || '');
    setTextColor(currentTextColor || '');
  }, [currentBackgroundColor, currentTextColor]);

  const hexColorRegex = /^#[0-9A-F]{6}$/i;

  const validateColor = (color: string): boolean => {
    return color === '' || hexColorRegex.test(color);
  };

  const handleBackgroundChange = (value: string) => {
    setBackgroundColor(value);
    if (value && !validateColor(value)) {
      setBackgroundError('Invalid hex color (e.g., #FF0000)');
    } else {
      setBackgroundError('');
    }
  };

  const handleTextChange = (value: string) => {
    setTextColor(value);
    if (value && !validateColor(value)) {
      setTextError('Invalid hex color (e.g., #FFFFFF)');
    } else {
      setTextError('');
    }
  };

  const handleSave = () => {
    if (!validateColor(backgroundColor) || (showTextColor && !validateColor(textColor))) {
      return;
    }
    
    onSave(
      backgroundColor || null,
      showTextColor ? (textColor || null) : null
    );
    setIsOpen(false);
  };

  const handleReset = () => {
    onSave(null, null);
    setBackgroundColor('');
    setTextColor('');
    setIsOpen(false);
  };

  const handlePresetClick = (preset: { background: string; text: string }) => {
    setBackgroundColor(preset.background);
    if (showTextColor) {
      setTextColor(preset.text);
      setTextError('');
    }
    setBackgroundError('');
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
          <h3 className="text-sm font-semibold text-gray-900">
            {showTextColor ? 'Customize Tag Colors' : 'Choose Color'}
          </h3>
          
          {/* Preset colors */}
          <div>
            <Label className="text-xs text-gray-700 mb-2 block">Quick Select</Label>
            <div className="grid grid-cols-6 gap-2">
              {PRESET_COLORS.map((preset, index) => {
                const isSelected = showTextColor 
                  ? backgroundColor === preset.background && textColor === preset.text
                  : backgroundColor === preset.background;
                return (
                  <button
                    key={index}
                    type="button"
                    className={`w-full h-8 ${showTextColor ? 'rounded' : 'rounded-full'} border-2 hover:border-gray-400 transition-colors ${
                      isSelected ? 'border-gray-600 ring-2 ring-gray-300' : 'border-gray-300'
                    }`}
                    style={{ backgroundColor: preset.background }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handlePresetClick(preset);
                    }}
                    aria-label={`Select preset color ${index + 1}`}
                    title={showTextColor ? `Background: ${preset.background}, Text: ${preset.text}` : preset.background}
                  >
                    {showTextColor && (
                      <span
                        className="text-xs font-medium"
                        style={{ color: preset.text }}
                      >
                        Aa
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom color inputs */}
          <div className="space-y-3">
            <div>
              <Label htmlFor="background-color" className="text-xs text-gray-700">
                Background Color
              </Label>
              <div className="flex gap-2 mt-1">
                <Input
                  id="background-color"
                  value={backgroundColor}
                  onChange={(e) => handleBackgroundChange(e.target.value)}
                  placeholder="#FF0000"
                  className="flex-1"
                />
                <input
                  type="color"
                  value={backgroundColor || '#FF0000'}
                  onChange={(e) => handleBackgroundChange(e.target.value)}
                  className="w-10 h-10 rounded border border-gray-300 cursor-pointer"
                  title="Pick background color"
                />
              </div>
              {backgroundError && (
                <p className="text-xs text-red-600 mt-1">{backgroundError}</p>
              )}
            </div>

            {showTextColor && (
              <div>
                <Label htmlFor="text-color" className="text-xs text-gray-700">
                  Text Color
                </Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    id="text-color"
                    value={textColor}
                    onChange={(e) => handleTextChange(e.target.value)}
                    placeholder="#FFFFFF"
                    className="flex-1"
                  />
                  <input
                    type="color"
                    value={textColor || '#000000'}
                    onChange={(e) => handleTextChange(e.target.value)}
                    className="w-10 h-10 rounded border border-gray-300 cursor-pointer"
                    title="Pick text color"
                  />
                </div>
                {textError && (
                  <p className="text-xs text-red-600 mt-1">{textError}</p>
                )}
              </div>
            )}
          </div>

          {/* Preview */}
          {(backgroundColor || (!showTextColor || textColor)) && 
           validateColor(backgroundColor) && 
           (!showTextColor || validateColor(textColor)) && (
            <div>
              <Label className="text-xs text-gray-700 mb-2 block">Preview</Label>
              {previewType === 'circle' ? (
                <div className="flex justify-center">
                  <div
                    className="w-12 h-12 rounded-full border-2 border-gray-300"
                    style={{ backgroundColor: backgroundColor || '#E5E7EB' }}
                  />
                </div>
              ) : (
                <div
                  className="px-3 py-1 rounded-full inline-block"
                  style={{
                    backgroundColor: backgroundColor || '#E5E7EB',
                    color: textColor || '#374151',
                  }}
                >
                  <span className="text-sm">Sample Tag</span>
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex justify-between pt-2">
            <Button
              id="color-picker-reset"
              variant="outline"
              size="sm"
              onClick={handleReset}
            >
              Reset to default
            </Button>
            <div className="space-x-2">
              <Button
                id="color-picker-cancel"
                variant="outline"
                size="sm"
                onClick={() => setIsOpen(false)}
              >
                Cancel
              </Button>
              <Button
                id="color-picker-save"
                size="sm"
                onClick={handleSave}
                disabled={!!backgroundError || !!textError}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default ColorPicker;
