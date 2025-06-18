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
}

const PRESET_COLORS = [
  { background: '#FEE2E2', text: '#991B1B' }, // Red
  { background: '#FED7AA', text: '#9A3412' }, // Orange
  { background: '#FEF3C7', text: '#92400E' }, // Yellow
  { background: '#D1FAE5', text: '#065F46' }, // Green
  { background: '#DBEAFE', text: '#1E40AF' }, // Blue
  { background: '#E9D5FF', text: '#6B21A8' }, // Purple
  { background: '#FCE7F3', text: '#9D174D' }, // Pink
  { background: '#F3F4F6', text: '#374151' }, // Gray
];

const ColorPicker: React.FC<ColorPickerProps> = ({
  currentBackgroundColor,
  currentTextColor,
  onSave,
  trigger,
}) => {
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
    if (!validateColor(backgroundColor) || !validateColor(textColor)) {
      return;
    }
    
    onSave(
      backgroundColor || null,
      textColor || null
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
    setTextColor(preset.text);
    setBackgroundError('');
    setTextError('');
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className="w-80 p-4 bg-white border border-gray-200 rounded-lg shadow-lg z-50"
        sideOffset={5}
      >
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-900">Customize Tag Colors</h3>
          
          {/* Preset colors */}
          <div>
            <Label className="text-xs text-gray-700 mb-2 block">Quick Select</Label>
            <div className="grid grid-cols-4 gap-2">
              {PRESET_COLORS.map((preset, index) => (
                <button
                  key={index}
                  className="w-full h-8 rounded border border-gray-300 hover:border-gray-400 transition-colors"
                  style={{ backgroundColor: preset.background }}
                  onClick={() => handlePresetClick(preset)}
                  aria-label={`Select preset color ${index + 1}`}
                >
                  <span
                    className="text-xs font-medium"
                    style={{ color: preset.text }}
                  >
                    Aa
                  </span>
                </button>
              ))}
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
                {backgroundColor && (
                  <div
                    className="w-10 h-10 rounded border border-gray-300"
                    style={{ backgroundColor: validateColor(backgroundColor) ? backgroundColor : '#FFF' }}
                  />
                )}
              </div>
              {backgroundError && (
                <p className="text-xs text-red-600 mt-1">{backgroundError}</p>
              )}
            </div>

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
                {textColor && (
                  <div
                    className="w-10 h-10 rounded border border-gray-300 flex items-center justify-center"
                    style={{ backgroundColor: validateColor(textColor) ? textColor : '#FFF' }}
                  >
                    <span className="text-xs font-bold" style={{ color: textColor === '#FFFFFF' ? '#000' : '#FFF' }}>
                      Aa
                    </span>
                  </div>
                )}
              </div>
              {textError && (
                <p className="text-xs text-red-600 mt-1">{textError}</p>
              )}
            </div>
          </div>

          {/* Preview */}
          {(backgroundColor || textColor) && validateColor(backgroundColor) && validateColor(textColor) && (
            <div>
              <Label className="text-xs text-gray-700 mb-2 block">Preview</Label>
              <div
                className="px-3 py-1 rounded-full inline-block"
                style={{
                  backgroundColor: backgroundColor || '#E5E7EB',
                  color: textColor || '#374151',
                }}
              >
                <span className="text-sm">Sample Tag</span>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex justify-between pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
            >
              Reset to default
            </Button>
            <div className="space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsOpen(false)}
              >
                Cancel
              </Button>
              <Button
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