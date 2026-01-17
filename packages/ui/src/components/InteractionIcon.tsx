'use client'

import React from 'react';
import { getIconComponent } from './IconPicker';
import { FileText } from 'lucide-react';
import { cn } from '../lib/utils';

interface InteractionIconProps {
  /** The icon value from database (e.g., 'phone', 'mail', 'users') */
  icon?: string;
  /** The interaction type name for fallback mapping */
  typeName?: string;
  /** Additional CSS classes */
  className?: string;
  /** Icon size */
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Displays an icon for interaction types with proper fallback handling.
 * Supports both explicit icon values and type name-based mapping.
 */
export const InteractionIcon = ({
  icon,
  typeName,
  className,
  size = 'md'
}: InteractionIconProps) => {
  // Size mappings
  const sizeClasses = {
    sm: 'h-3 w-3',
    md: 'h-4 w-4', 
    lg: 'h-5 w-5'
  };

  // First try to use the explicit icon value
  if (icon) {
    const IconComponent = getIconComponent(icon);
    return (
      <IconComponent 
        className={cn(sizeClasses[size], 'text-gray-500', className)} 
      />
    );
  }

  // Fallback to type name-based mapping for backward compatibility
  if (typeName) {
    const lowerType = typeName.toLowerCase();
    let iconValue = '';
    
    // Map common type names to icon values
    if (lowerType.includes('call') || lowerType.includes('phone')) {
      iconValue = 'phone';
    } else if (lowerType.includes('email') || lowerType.includes('mail')) {
      iconValue = 'mail';
    } else if (lowerType.includes('meeting') || lowerType.includes('conference')) {
      iconValue = 'users';
    } else if (lowerType.includes('note') || lowerType.includes('comment')) {
      iconValue = 'file-text';
    } else if (lowerType.includes('task') || lowerType.includes('todo')) {
      iconValue = 'check-square';
    } else if (lowerType.includes('video')) {
      iconValue = 'video';
    } else if (lowerType.includes('presentation') || lowerType.includes('demo')) {
      iconValue = 'presentation';
    }

    if (iconValue) {
      const IconComponent = getIconComponent(iconValue);
      return (
        <IconComponent 
          className={cn(sizeClasses[size], 'text-gray-500', className)} 
        />
      );
    }
  }

  // Ultimate fallback to FileText
  return (
    <FileText 
      className={cn(sizeClasses[size], 'text-gray-500', className)} 
    />
  );
};

export default InteractionIcon;
