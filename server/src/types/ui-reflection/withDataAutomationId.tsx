import React from 'react';
import { UIComponent } from './types';

/**
 * Utility function to ensure data-automation-id matches UI state ID
 * 
 * @param props Component props that may include an id
 * @returns Props with data-automation-id matching the id if present
 */
export function withDataAutomationId<P extends { id?: string }>(props: P): P & { 'data-automation-id'?: string } {
  if (!props.id) return props;
  
  return {
    ...props,
    'data-automation-id': props.id
  };
}

/**
 * HOC to automatically add data-automation-id to components using UI reflection
 * 
 * @param WrappedComponent The component to wrap
 * @returns A component with automatic data-automation-id handling
 * 
 * @example
 * ```tsx
 * const MyButton = withUIReflectionId(Button);
 * // Now data-automation-id will automatically match the id prop
 * <MyButton id="submit-button" />
 * ```
 */
export function withUIReflectionId<P extends { id?: string }>(
  WrappedComponent: React.ComponentType<P>
): React.FC<P> {
  return function WithUIReflectionId(props: P) {
    return <WrappedComponent {...withDataAutomationId(props)} />;
  };
}
