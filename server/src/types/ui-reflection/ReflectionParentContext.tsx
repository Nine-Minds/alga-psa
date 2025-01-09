'use client';

import React from 'react';

/**
 * React context for providing parent component IDs in the UI reflection system.
 * This enables automatic parent-child relationships without manual prop passing.
 */
export const ReflectionParentContext = React.createContext<string | null>(null);

/**
 * Hook to access the current parent component's ID from context
 */
export function useReflectionParent() {
  return React.useContext(ReflectionParentContext);
}
