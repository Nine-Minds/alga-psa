'use client';

import React from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface VisibilityToggleProps {
  isClientVisible: boolean;
  onToggle: (nextValue: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export default function VisibilityToggle({
  isClientVisible,
  onToggle,
  disabled = false,
  id,
  className = '',
}: VisibilityToggleProps) {
  const label = isClientVisible ? 'Visible to clients' : 'Hidden from clients';

  return (
    <button
      id={id}
      type="button"
      disabled={disabled}
      aria-label={label}
      aria-pressed={isClientVisible}
      title={label}
      onClick={() => onToggle(!isClientVisible)}
      className={`p-1 rounded transition-colors ${
        disabled
          ? 'opacity-50 cursor-not-allowed'
          : 'hover:bg-gray-100 dark:hover:bg-[rgb(var(--color-border-100))]'
      } ${className}`.trim()}
    >
      {isClientVisible ? (
        <Eye className="w-4 h-4 text-green-600" />
      ) : (
        <EyeOff className="w-4 h-4 text-gray-500" />
      )}
    </button>
  );
}
