'use client';

import React, { useContext, useDebugValue, PropsWithChildren } from 'react';

let providerCounter = 0;

/**
 * React context for providing parent component IDs in the UI reflection system.
 * This enables automatic parent-child relationships without manual prop passing.
 */
export const ReflectionParentContext = React.createContext<string | null>(null);

// Add a display name for better debugging
ReflectionParentContext.displayName = 'ReflectionParentContext';

/**
 * Hook to access the current parent component's ID from context
 */
export function useReflectionParent() {
  const context = useContext(ReflectionParentContext);
  
  // Add debug value for React DevTools
  useDebugValue(context, value => 
    value ? `Parent ID: ${value}` : 'No Parent'
  );

  return context;
}

/**
 * Provider component that wraps ReflectionParentContext.Provider with logging
 */
export function ReflectionParentProvider({ 
  children, 
  value 
}: PropsWithChildren<{ value: string | null }>) {
  const providerId = `provider_${Date.now()}_${++providerCounter}`;

  return (
    <ReflectionParentContext.Provider value={value}>
      {children}
    </ReflectionParentContext.Provider>
  );
}

/**
 * HOC that wraps a component with ReflectionParentProvider
 */
export function withReflectionParent<P extends object>(
  Component: React.ComponentType<P>,
  parentId: string
) {
  return function WrappedComponent(props: P) {
    return (
      <ReflectionParentProvider value={parentId}>
        <Component {...props} />
      </ReflectionParentProvider>
    );
  };
}
