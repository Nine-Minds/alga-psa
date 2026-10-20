'use client';

import React, { useContext, useDebugValue, PropsWithChildren } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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
  const { t } = useTranslation('common');
  const context = useContext(ReflectionParentContext);
  
  // Add debug value for React DevTools
  useDebugValue(context, value => 
    value ? t('reflection.parentId', { id: value }) : t('reflection.noParent')
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
    <ReflectionParentContext value={value}>
      {children}
    </ReflectionParentContext>
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
