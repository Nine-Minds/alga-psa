'use client';

import React from 'react';
import { ArrowRight, Minus } from 'lucide-react';

interface FieldChangeDiffProps {
  fieldName: string;
  oldValue: any;
  newValue: any;
  variant?: 'inline' | 'block';
  className?: string;
}

/**
 * Formats a value for display
 */
function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return 'None';
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (typeof value === 'object') {
    // Handle arrays
    if (Array.isArray(value)) {
      if (value.length === 0) return 'None';
      return value.join(', ');
    }
    // Handle objects with label/name properties
    if (value.label) return value.label;
    if (value.name) return value.name;
    // Fallback to JSON
    return JSON.stringify(value);
  }

  // Handle dates (ISO format)
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    try {
      const date = new Date(value);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: value.includes('T') ? '2-digit' : undefined,
        minute: value.includes('T') ? '2-digit' : undefined
      });
    } catch {
      return value;
    }
  }

  return String(value);
}

/**
 * Displays a before/after diff for a field change
 */
export function FieldChangeDiff({
  fieldName,
  oldValue,
  newValue,
  variant = 'inline',
  className = ''
}: FieldChangeDiffProps) {
  const formattedOld = formatValue(oldValue);
  const formattedNew = formatValue(newValue);
  const hasOldValue = oldValue !== null && oldValue !== undefined;
  const hasNewValue = newValue !== null && newValue !== undefined;

  if (variant === 'block') {
    return (
      <div className={`rounded-lg border border-gray-200 overflow-hidden ${className}`}>
        <div className="bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 border-b border-gray-200">
          {fieldName}
        </div>
        <div className="p-3 space-y-2">
          {hasOldValue && (
            <div className="flex items-start gap-2">
              <span className="text-xs font-medium text-gray-500 w-12">From:</span>
              <span className="text-sm text-red-600 bg-red-50 px-2 py-0.5 rounded line-through">
                {formattedOld}
              </span>
            </div>
          )}
          {hasNewValue && (
            <div className="flex items-start gap-2">
              <span className="text-xs font-medium text-gray-500 w-12">To:</span>
              <span className="text-sm text-green-600 bg-green-50 px-2 py-0.5 rounded">
                {formattedNew}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Inline variant
  return (
    <span className={`inline-flex items-center gap-1 text-sm ${className}`}>
      <span className="font-medium text-gray-700">{fieldName}:</span>
      {hasOldValue ? (
        <span className="text-red-600 bg-red-50 px-1.5 py-0.5 rounded text-xs">
          {formattedOld}
        </span>
      ) : (
        <span className="text-gray-400 text-xs">
          <Minus className="w-3 h-3" />
        </span>
      )}
      <ArrowRight className="w-3 h-3 text-gray-400" />
      {hasNewValue ? (
        <span className="text-green-600 bg-green-50 px-1.5 py-0.5 rounded text-xs">
          {formattedNew}
        </span>
      ) : (
        <span className="text-gray-400 text-xs">
          <Minus className="w-3 h-3" />
        </span>
      )}
    </span>
  );
}

/**
 * Compact version showing just the new value (for lists)
 */
export function FieldChangeCompact({
  fieldName,
  newValue,
  className = ''
}: {
  fieldName: string;
  newValue: any;
  className?: string;
}) {
  const formattedNew = formatValue(newValue);

  return (
    <span className={`text-sm ${className}`}>
      <span className="text-gray-600">{fieldName}</span>
      <span className="text-gray-400 mx-1">→</span>
      <span className="font-medium text-gray-900">{formattedNew}</span>
    </span>
  );
}

export default FieldChangeDiff;
