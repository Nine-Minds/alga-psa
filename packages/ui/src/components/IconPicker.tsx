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
import { cn } from '../lib/utils';

export interface IconOption {
  value: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  category: string;
}

const INTERACTION_ICONS: IconOption[] = [
  // Communication
  { value: 'phone', label: 'Phone', icon: Phone, category: 'Communication' },
  { value: 'mail', label: 'Email', icon: Mail, category: 'Communication' },
  { value: 'message-circle', label: 'Message', icon: MessageCircle, category: 'Communication' },
  { value: 'video', label: 'Video Call', icon: Video, category: 'Communication' },
  { value: 'send', label: 'Send', icon: Send, category: 'Communication' },

  // Meetings & Events  
  { value: 'users', label: 'Meeting', icon: Users, category: 'Meetings' },
  { value: 'calendar', label: 'Appointment', icon: Calendar, category: 'Meetings' },
  { value: 'presentation', label: 'Presentation', icon: Presentation, category: 'Meetings' },
  { value: 'coffee', label: 'Informal Meeting', icon: Coffee, category: 'Meetings' },
  { value: 'handshake', label: 'Agreement', icon: Handshake, category: 'Meetings' },

  // Documents & Notes
  { value: 'file-text', label: 'Document', icon: FileText, category: 'Documents' },
  { value: 'sticky-note', label: 'Note', icon: StickyNote, category: 'Documents' },
  { value: 'edit', label: 'Edit', icon: Edit, category: 'Documents' },

  // Tasks & Actions
  { value: 'flag', label: 'Follow-up', icon: Flag, category: 'Tasks' },
  { value: 'alarm-clock', label: 'Reminder', icon: AlarmClock, category: 'Tasks' },
  { value: 'clock', label: 'Time Tracking', icon: Clock, category: 'Tasks' },

  // Activities
  { value: 'activity', label: 'General Activity', icon: Activity, category: 'Activities' },
  { value: 'briefcase', label: 'Account Management', icon: Briefcase, category: 'Activities' },
  { value: 'search', label: 'Research', icon: Search, category: 'Activities' },
  { value: 'book-open', label: 'Training', icon: BookOpen, category: 'Activities' },
  { value: 'headphones', label: 'Support', icon: Headphones, category: 'Activities' },
  { value: 'check-square', label: 'Review', icon: CheckSquare, category: 'Activities' },
  { value: 'clipboard', label: 'Documentation', icon: Clipboard, category: 'Activities' },
  { value: 'users-2', label: 'Consultation', icon: Users2, category: 'Activities' },
  { value: 'target', label: 'Planning', icon: Target, category: 'Activities' },

  // Business & General
  { value: 'settings', label: 'Configuration', icon: Settings, category: 'Business' },
  { value: 'star', label: 'Important', icon: Star, category: 'Business' },
  { value: 'award', label: 'Achievement', icon: Award, category: 'Business' },
  { value: 'zap', label: 'Quick Action', icon: Zap, category: 'Business' },
  { value: 'map-pin', label: 'Location', icon: MapPin, category: 'Business' },
  { value: 'tag', label: 'Label', icon: Tag, category: 'Business' },
  { value: 'bell', label: 'Notification', icon: Bell, category: 'Business' },
  { value: 'shield', label: 'Security', icon: Shield, category: 'Business' },
  { value: 'key', label: 'Access', icon: Key, category: 'Business' },
  { value: 'heart', label: 'Favorite', icon: Heart, category: 'Business' },
];

const ICON_CATEGORIES = ['Communication', 'Meetings', 'Documents', 'Tasks', 'Activities', 'Business'];

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
  const [selectedCategory, setSelectedCategory] = useState<string>('Communication');
  
  const selectedIcon = INTERACTION_ICONS.find(icon => icon.value === value);
  const filteredIcons = INTERACTION_ICONS.filter(icon => icon.category === selectedCategory);

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
            {category}
          </Button>
        ))}
      </div>

      {/* Selected Icon Preview */}
      {selectedIcon && (
        <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
          <selectedIcon.icon className="h-5 w-5 text-gray-600" />
          <span className="text-sm text-gray-700">
            Selected: {selectedIcon.label}
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
        Select an icon to represent this interaction type. The icon will be displayed in lists and forms.
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
