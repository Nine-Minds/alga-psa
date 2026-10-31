'use client'

import React, { useState } from 'react';
import { 
  Phone, Mail, Users, FileText, MessageCircle, Video, Headphones,
  Calendar, Presentation, Coffee, Handshake, StickyNote, BookOpen,
  Clipboard, Edit, CheckSquare, Target, Flag, AlarmClock, Settings,
  Star, Heart, Zap, Award, Briefcase, Clock, MapPin, Tag,
  Bell, Shield, Key, Search, Send, Activity, Users2
} from 'lucide-react';
import { Button } from './Button';
import { useTranslation } from '../lib/i18n/client';
import { cn } from '../lib/utils';

export interface IconOption {
  value: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  category: string;
}

const INTERACTION_ICONS: Omit<IconOption, 'label'>[] = [
  // Communication
  { value: 'phone', icon: Phone, category: 'Communication' },
  { value: 'mail', icon: Mail, category: 'Communication' },
  { value: 'message-circle', icon: MessageCircle, category: 'Communication' },
  { value: 'video', icon: Video, category: 'Communication' },
  { value: 'send', icon: Send, category: 'Communication' },

  // Meetings & Events  
  { value: 'users', icon: Users, category: 'Meetings' },
  { value: 'calendar', icon: Calendar, category: 'Meetings' },
  { value: 'presentation', icon: Presentation, category: 'Meetings' },
  { value: 'coffee', icon: Coffee, category: 'Meetings' },
  { value: 'handshake', icon: Handshake, category: 'Meetings' },

  // Documents & Notes
  { value: 'file-text', icon: FileText, category: 'Documents' },
  { value: 'sticky-note', icon: StickyNote, category: 'Documents' },
  { value: 'edit', icon: Edit, category: 'Documents' },

  // Tasks & Actions
  { value: 'flag', icon: Flag, category: 'Tasks' },
  { value: 'alarm-clock', icon: AlarmClock, category: 'Tasks' },
  { value: 'clock', icon: Clock, category: 'Tasks' },

  // Activities
  { value: 'activity', icon: Activity, category: 'Activities' },
  { value: 'briefcase', icon: Briefcase, category: 'Activities' },
  { value: 'search', icon: Search, category: 'Activities' },
  { value: 'book-open', icon: BookOpen, category: 'Activities' },
  { value: 'headphones', icon: Headphones, category: 'Activities' },
  { value: 'check-square', icon: CheckSquare, category: 'Activities' },
  { value: 'clipboard', icon: Clipboard, category: 'Activities' },
  { value: 'users-2', icon: Users2, category: 'Activities' },
  { value: 'target', icon: Target, category: 'Activities' },

  // Business & General
  { value: 'settings', icon: Settings, category: 'Business' },
  { value: 'star', icon: Star, category: 'Business' },
  { value: 'award', icon: Award, category: 'Business' },
  { value: 'zap', icon: Zap, category: 'Business' },
  { value: 'map-pin', icon: MapPin, category: 'Business' },
  { value: 'tag', icon: Tag, category: 'Business' },
  { value: 'bell', icon: Bell, category: 'Business' },
  { value: 'shield', icon: Shield, category: 'Business' },
  { value: 'key', icon: Key, category: 'Business' },
  { value: 'heart', icon: Heart, category: 'Business' },
];

const ICON_CATEGORIES = ['Communication', 'Meetings', 'Documents', 'Tasks', 'Activities', 'Business'];

export function useInteractionIconOptions(): IconOption[] {
  const { t } = useTranslation('common');
  return INTERACTION_ICONS.map(icon => ({
    ...icon,
    label: t(`iconPicker.enums.icons.${icon.value}`),
  }));
}

interface IconPickerProps {
  value?: string;
  onValueChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
}

export const IconPicker = ({
  value,
  onValueChange,
  className,
  disabled = false
}: IconPickerProps) => {
  const { t } = useTranslation('common');
  const icons = useInteractionIconOptions();
  const [selectedCategory, setSelectedCategory] = useState<string>('Communication');
  
  const selectedIcon = icons.find(icon => icon.value === value);
  const filteredIcons = icons.filter(icon => icon.category === selectedCategory);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Category Tabs */}
      <div className="flex flex-wrap gap-1 border-b">
        {ICON_CATEGORIES.map((category) => (
          <Button
            key={category}
            id={`icon-category-${category.toLowerCase()}`}
            variant={selectedCategory === category ? "default" : "ghost"}
            size="sm"
            onClick={() => setSelectedCategory(category)}
            disabled={disabled}
            className="text-xs"
          >
            {t(`iconPicker.enums.categories.${category}`)}
          </Button>
        ))}
      </div>

      {/* Selected Icon Preview */}
      {selectedIcon && (
        <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
          <selectedIcon.icon className="h-5 w-5 text-gray-600" />
          <span className="text-sm text-gray-700">
            {t('iconPicker.selected', { label: selectedIcon.label })}
          </span>
        </div>
      )}

      {/* Icon Grid */}
      <div className="grid grid-cols-6 gap-2 max-h-64 overflow-y-auto">
        {filteredIcons.map((iconOption) => {
          const IconComponent = iconOption.icon;
          const isSelected = value === iconOption.value;
          
          return (
            <Button
              key={iconOption.value}
              id={`icon-option-${iconOption.value}`}
              variant={isSelected ? "default" : "outline"}
              size="sm"
              onClick={() => onValueChange(iconOption.value)}
              disabled={disabled}
              className={cn(
                "flex flex-col items-center gap-1 h-16 p-2",
                isSelected && "ring-2 ring-primary-500"
              )}
              title={iconOption.label}
            >
              <IconComponent className={cn(
                "h-4 w-4",
                isSelected ? "text-white" : "text-gray-600"
              )} />
              <span className={cn(
                "text-xs truncate w-full text-center",
                isSelected ? "text-white" : "text-gray-600"
              )}>
                {iconOption.label}
              </span>
            </Button>
          );
        })}
      </div>

      {/* Helper text */}
      <p className="text-xs text-gray-500">
        {t('iconPicker.help')}
      </p>
    </div>
  );
};

// Export the icon mapping for use in other components
export const getIconComponent = (iconValue: string): React.ComponentType<{ className?: string }> => {
  const iconOption = INTERACTION_ICONS.find(icon => icon.value === iconValue);
  return iconOption?.icon || FileText;
};

// Export the icon options for external use
export { INTERACTION_ICONS };
