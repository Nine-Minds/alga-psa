'use client';

import React from 'react';
import {
  Type,
  Hash,
  Calendar,
  ToggleLeft,
  List,
  ListChecks,
  HelpCircle
} from 'lucide-react';
import { CustomFieldType } from 'server/src/interfaces/customField.interfaces';

interface FieldTypeIconProps {
  type: CustomFieldType;
  className?: string;
  size?: number;
}

/**
 * Visual icon representation for each custom field type
 * Used in field lists, drag-drop items, and field type selectors
 */
export function FieldTypeIcon({ type, className = '', size = 16 }: FieldTypeIconProps) {
  const iconProps = {
    className: `${className}`,
    size,
  };

  switch (type) {
    case 'text':
      return <Type {...iconProps} />;
    case 'number':
      return <Hash {...iconProps} />;
    case 'date':
      return <Calendar {...iconProps} />;
    case 'boolean':
      return <ToggleLeft {...iconProps} />;
    case 'picklist':
      return <List {...iconProps} />;
    case 'multi_picklist':
      return <ListChecks {...iconProps} />;
    default:
      return <HelpCircle {...iconProps} />;
  }
}

/**
 * Get the display label for a field type
 */
export function getFieldTypeLabel(type: CustomFieldType): string {
  switch (type) {
    case 'text':
      return 'Text';
    case 'number':
      return 'Number';
    case 'date':
      return 'Date';
    case 'boolean':
      return 'Yes/No';
    case 'picklist':
      return 'Dropdown';
    case 'multi_picklist':
      return 'Multi-Select';
    default:
      return type;
  }
}

/**
 * Get the color class for a field type (for badges/chips)
 */
export function getFieldTypeColor(type: CustomFieldType): string {
  switch (type) {
    case 'text':
      return 'bg-blue-100 text-blue-700';
    case 'number':
      return 'bg-green-100 text-green-700';
    case 'date':
      return 'bg-purple-100 text-purple-700';
    case 'boolean':
      return 'bg-yellow-100 text-yellow-700';
    case 'picklist':
      return 'bg-orange-100 text-orange-700';
    case 'multi_picklist':
      return 'bg-pink-100 text-pink-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

/**
 * Field type badge with icon and label
 */
export function FieldTypeBadge({ type, className = '' }: { type: CustomFieldType; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${getFieldTypeColor(type)} ${className}`}
    >
      <FieldTypeIcon type={type} size={12} />
      {getFieldTypeLabel(type)}
    </span>
  );
}

export default FieldTypeIcon;
