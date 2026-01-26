'use client';

import React, { useState } from 'react';
import { CheckCircle, AlertTriangle, XCircle, Circle, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { Badge } from '@alga-psa/ui/components/Badge';
import type { PublishError } from '@shared/workflow/runtime';

export type ValidationStatus = 'valid' | 'warning' | 'error' | 'incomplete';

export interface ValidationBadgeProps {
  /**
   * Validation errors for this step
   */
  errors: PublishError[];

  /**
   * Number of mapped fields (for display)
   */
  mappedCount?: number;

  /**
   * Total required fields (for display)
   */
  requiredCount?: number;

  /**
   * Callback to open mapping editor
   */
  onOpenEditor?: () => void;

  /**
   * Whether the step has any mappings configured
   */
  hasMappings?: boolean;

  /**
   * Size variant
   */
  size?: 'sm' | 'md';
}

/**
 * Determine validation status from errors
 */
const getValidationStatus = (
  errors: PublishError[],
  hasMappings?: boolean
): ValidationStatus => {
  const errorCount = errors.filter(e => e.severity === 'error').length;
  const warningCount = errors.filter(e => e.severity === 'warning').length;

  if (errorCount > 0) return 'error';
  if (warningCount > 0) return 'warning';
  if (hasMappings === false) return 'incomplete';
  return 'valid';
};

/**
 * Get icon for validation status
 */
const getStatusIcon = (status: ValidationStatus, size: 'sm' | 'md') => {
  const iconClass = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';

  switch (status) {
    case 'valid':
      return <CheckCircle className={`${iconClass} text-green-600`} />;
    case 'warning':
      return <AlertTriangle className={`${iconClass} text-yellow-600`} />;
    case 'error':
      return <XCircle className={`${iconClass} text-red-600`} />;
    case 'incomplete':
      return <Circle className={`${iconClass} text-gray-400`} />;
  }
};

/**
 * Get badge styling for validation status
 */
const getStatusStyle = (status: ValidationStatus): string => {
  switch (status) {
    case 'valid':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'warning':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'error':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'incomplete':
      return 'bg-gray-100 text-gray-600 border-gray-200';
  }
};

/**
 * Get status label
 */
const getStatusLabel = (status: ValidationStatus): string => {
  switch (status) {
    case 'valid':
      return 'Valid';
    case 'warning':
      return 'Warnings';
    case 'error':
      return 'Errors';
    case 'incomplete':
      return 'Incomplete';
  }
};

/**
 * ValidationBadge component
 *
 * Displays validation status with hover tooltip showing detailed error information.
 * Supports four states: valid (green), warning (yellow), error (red), incomplete (gray).
 */
export const ValidationBadge: React.FC<ValidationBadgeProps> = ({
  errors,
  mappedCount,
  requiredCount,
  onOpenEditor,
  hasMappings,
  size = 'sm'
}) => {
  const [expanded, setExpanded] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  const status = getValidationStatus(errors, hasMappings);
  const errorList = errors.filter(e => e.severity === 'error');
  const warningList = errors.filter(e => e.severity === 'warning');

  const handleBadgeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (errors.length > 0) {
      setExpanded(!expanded);
    } else if (onOpenEditor) {
      onOpenEditor();
    }
  };

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Badge */}
      <button
        onClick={handleBadgeClick}
        className={`
          inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium
          transition-colors cursor-pointer hover:opacity-80
          ${getStatusStyle(status)}
        `}
      >
        {getStatusIcon(status, size)}
        {errors.length > 0 ? (
          <span>{errors.length}</span>
        ) : mappedCount !== undefined && requiredCount !== undefined ? (
          <span>{mappedCount}/{requiredCount}</span>
        ) : (
          <span>{getStatusLabel(status)}</span>
        )}
        {errors.length > 0 && (
          expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
        )}
      </button>

      {/* Hover Tooltip */}
      {showTooltip && !expanded && errors.length === 0 && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg">
          <div className="text-center">
            {status === 'valid' && 'All required inputs are mapped'}
            {status === 'incomplete' && 'Configure input mappings'}
            {mappedCount !== undefined && requiredCount !== undefined && (
              <div className="mt-1 text-gray-300">
                {mappedCount} of {requiredCount} required fields mapped
              </div>
            )}
          </div>
          {onOpenEditor && (
            <button
              onClick={(e) => { e.stopPropagation(); onOpenEditor(); }}
              className="mt-2 w-full flex items-center justify-center gap-1 py-1 bg-gray-800 hover:bg-gray-700 rounded text-gray-200"
            >
              <ExternalLink className="w-3 h-3" />
              Open Mapping Editor
            </button>
          )}
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45" />
        </div>
      )}

      {/* Expanded Error Details */}
      {expanded && errors.length > 0 && (
        <div className="absolute z-50 top-full left-0 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          {/* Error list */}
          {errorList.length > 0 && (
            <div className="p-2 border-b border-gray-100">
              <div className="flex items-center gap-1 text-xs font-semibold text-red-700 mb-1">
                <XCircle className="w-3 h-3" />
                Errors ({errorList.length})
              </div>
              <ul className="space-y-1">
                {errorList.slice(0, 5).map((err, i) => (
                  <li key={i} className="text-xs text-gray-700 pl-4">
                    <span className="font-mono text-red-600">{err.code}</span>
                    <span className="mx-1">-</span>
                    <span>{err.message}</span>
                    {err.stepPath && (
                      <div className="text-gray-400 font-mono text-[10px] truncate">
                        {err.stepPath}
                      </div>
                    )}
                  </li>
                ))}
                {errorList.length > 5 && (
                  <li className="text-xs text-gray-500 pl-4">
                    +{errorList.length - 5} more errors
                  </li>
                )}
              </ul>
            </div>
          )}

          {/* Warning list */}
          {warningList.length > 0 && (
            <div className="p-2 border-b border-gray-100">
              <div className="flex items-center gap-1 text-xs font-semibold text-yellow-700 mb-1">
                <AlertTriangle className="w-3 h-3" />
                Warnings ({warningList.length})
              </div>
              <ul className="space-y-1">
                {warningList.slice(0, 3).map((warn, i) => (
                  <li key={i} className="text-xs text-gray-700 pl-4">
                    <span className="font-mono text-yellow-600">{warn.code}</span>
                    <span className="mx-1">-</span>
                    <span>{warn.message}</span>
                  </li>
                ))}
                {warningList.length > 3 && (
                  <li className="text-xs text-gray-500 pl-4">
                    +{warningList.length - 3} more warnings
                  </li>
                )}
              </ul>
            </div>
          )}

          {/* Quick action */}
          {onOpenEditor && (
            <div className="p-2 bg-gray-50">
              <button
                onClick={(e) => { e.stopPropagation(); onOpenEditor(); }}
                className="w-full flex items-center justify-center gap-1 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-xs rounded"
              >
                <ExternalLink className="w-3 h-3" />
                Open Mapping Editor
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ValidationBadge;
