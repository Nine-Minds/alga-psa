'use client';

/**
 * Loading Skeleton for Mapping Editor
 *
 * Displays a placeholder UI while the mapping editor is loading
 * action schemas or resolving available data context.
 *
 * §19.6 - Loading and Error States
 */

import React from 'react';

/**
 * Skeleton line component with shimmer animation
 */
const SkeletonLine: React.FC<{
  width?: string;
  height?: string;
  className?: string;
}> = ({ width = '100%', height = '16px', className = '' }) => (
  <div
    className={`bg-gray-200 rounded animate-pulse ${className}`}
    style={{ width, height }}
  />
);

/**
 * Skeleton card for a mapping field
 */
const SkeletonField: React.FC = () => (
  <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-white">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <SkeletonLine width="16px" height="16px" />
        <SkeletonLine width="120px" height="14px" />
      </div>
      <SkeletonLine width="80px" height="28px" className="rounded-md" />
    </div>
    <div className="pl-6 space-y-2">
      <SkeletonLine width="60%" height="12px" />
      <SkeletonLine width="100%" height="64px" className="rounded-md" />
    </div>
  </div>
);

/**
 * Skeleton for the source data tree
 */
const SkeletonTree: React.FC = () => (
  <div className="space-y-2 p-2">
    {/* Search bar */}
    <SkeletonLine width="100%" height="32px" className="rounded-md" />

    {/* Section header */}
    <div className="flex items-center gap-2 py-2 px-3 bg-gray-50 rounded-lg">
      <SkeletonLine width="16px" height="16px" />
      <SkeletonLine width="16px" height="16px" />
      <SkeletonLine width="80px" height="14px" />
      <div className="flex-1" />
      <SkeletonLine width="24px" height="18px" className="rounded-full" />
    </div>

    {/* Tree items */}
    <div className="space-y-1 pl-4">
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="flex items-center gap-2 py-1 px-2">
          <SkeletonLine width="16px" height="16px" />
          <SkeletonLine width="14px" height="14px" />
          <SkeletonLine width={`${60 + Math.random() * 40}%`} height="14px" />
        </div>
      ))}
    </div>

    {/* Another section */}
    <div className="flex items-center gap-2 py-2 px-3 bg-gray-50 rounded-lg">
      <SkeletonLine width="16px" height="16px" />
      <SkeletonLine width="16px" height="16px" />
      <SkeletonLine width="100px" height="14px" />
      <div className="flex-1" />
      <SkeletonLine width="24px" height="18px" className="rounded-full" />
    </div>
  </div>
);

/**
 * Props for MappingEditorSkeleton
 */
export interface MappingEditorSkeletonProps {
  /** Number of field skeletons to show */
  fieldCount?: number;
  /** Whether to show the source tree skeleton */
  showSourceTree?: boolean;
  /** Custom message to display */
  message?: string;
}

/**
 * MappingEditorSkeleton component
 *
 * Displays a loading placeholder matching the structure of the actual mapping editor.
 */
export const MappingEditorSkeleton: React.FC<MappingEditorSkeletonProps> = ({
  fieldCount = 3,
  showSourceTree = true,
  message
}) => {
  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <SkeletonLine width="100px" height="16px" />
        <div className="flex items-center gap-3">
          <SkeletonLine width="80px" height="28px" className="rounded-md" />
          <SkeletonLine width="100px" height="14px" />
        </div>
      </div>

      {/* Optional message */}
      {message && (
        <div className="flex items-center justify-center py-4">
          <div className="flex items-center gap-2 text-gray-500">
            <div className="w-4 h-4 border-2 border-gray-300 border-t-primary-500 rounded-full animate-spin" />
            <span className="text-sm">{message}</span>
          </div>
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Source tree panel */}
        {showSourceTree && (
          <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
            <SkeletonTree />
          </div>
        )}

        {/* Target fields panel */}
        <div className={`space-y-3 ${showSourceTree ? '' : 'lg:col-span-2'}`}>
          {Array.from({ length: fieldCount }).map((_, i) => (
            <SkeletonField key={i} />
          ))}

          {/* Unmapped fields section */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <SkeletonLine width="16px" height="16px" />
              <SkeletonLine width="140px" height="12px" />
            </div>
            <div className="space-y-1 pl-5">
              {[1, 2].map(i => (
                <div key={i} className="flex items-center justify-between py-1.5 px-2">
                  <div className="flex items-center gap-2">
                    <SkeletonLine width={`${80 + Math.random() * 40}px`} height="14px" />
                    <SkeletonLine width="40px" height="16px" className="rounded-full" />
                  </div>
                  <SkeletonLine width="50px" height="24px" className="rounded-md" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Error state component for mapping editor
 */
export interface MappingEditorErrorProps {
  /** Error message to display */
  message: string;
  /** Callback when retry is clicked */
  onRetry?: () => void;
  /** Number of retry attempts made */
  retryCount?: number;
  /** Maximum retry attempts */
  maxRetries?: number;
}

export const MappingEditorError: React.FC<MappingEditorErrorProps> = ({
  message,
  onRetry,
  retryCount = 0,
  maxRetries = 3
}) => {
  const canRetry = onRetry && retryCount < maxRetries;

  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
      <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
        <svg
          className="w-6 h-6 text-red-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>

      <h3 className="text-lg font-semibold text-gray-900 mb-2">
        Failed to Load Schema
      </h3>

      <p className="text-sm text-gray-500 mb-4 max-w-md">
        {message}
      </p>

      {canRetry && (
        <div className="space-y-2">
          <button
            onClick={onRetry}
            className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
          >
            Retry {retryCount > 0 && `(${retryCount}/${maxRetries})`}
          </button>

          {retryCount > 0 && (
            <p className="text-xs text-gray-400">
              Attempt {retryCount} of {maxRetries}
            </p>
          )}
        </div>
      )}

      {!canRetry && retryCount >= maxRetries && (
        <div className="space-y-2">
          <p className="text-sm text-gray-500">
            Maximum retry attempts reached.
          </p>
          <a
            href="/support"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary-600 hover:text-primary-700 hover:underline"
          >
            Contact Support →
          </a>
        </div>
      )}
    </div>
  );
};

export default MappingEditorSkeleton;
