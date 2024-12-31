'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useUIState } from './UIStateContext';
import { UIComponent } from './types';

/**
 * Custom hook for registering UI components with the reflection system.
 * 
 * @template T - The specific component type (extends UIComponent)
 * @param component - The component's metadata to register
 * @returns A function to update the component's metadata
 * 
 * @example
 * ```tsx
 * function MyButton({ label, disabled }: Props) {
 *   const updateMetadata = useRegisterUIComponent<ButtonComponent>({
 *     id: 'my-button',
 *     type: 'button',
 *     label,
 *     disabled
 *   });
 * 
 *   // Update metadata when props change
 *   useEffect(() => {
 *     updateMetadata({ label, disabled });
 *   }, [label, disabled, updateMetadata]);
 * 
 *   return <button>{label}</button>;
 * }
 * ```
 */
export function useRegisterUIComponent<T extends UIComponent>(component: T) {
  const { registerComponent, unregisterComponent, updateComponent } = useUIState();
  
  // Keep a ref to the latest component for the cleanup function
  const componentRef = useRef(component);
  componentRef.current = component;

  // Register on mount, unregister on unmount
  useEffect(() => {
    registerComponent(component);

    return () => {
      unregisterComponent(componentRef.current.id);
    };
  }, [registerComponent, unregisterComponent]);

  /**
   * Update the component's metadata in the UI state
   * Memoized to allow usage in effect dependencies
   */
  const updateMetadata = useCallback(
    (partial: Partial<T>) => {
      // Validate that we're not changing the component type
      if (partial.type && partial.type !== component.type) {
        console.warn(
          `Cannot change component type from ${component.type} to ${partial.type}`
        );
        return;
      }

      updateComponent(component.id, partial);
    },
    [component.id, component.type, updateComponent]
  );

  return updateMetadata;
}

/**
 * Helper type to extract props that should trigger metadata updates
 * Excludes 'id' and 'type' as they should not be updated
 */
export type MetadataProps<T extends UIComponent> = {
  [K in Exclude<keyof T, 'id' | 'type'>]?: T[K];
};

/**
 * Helper hook to automatically update metadata when props change
 * 
 * @template T - The specific component type
 * @param component - The component's metadata
 * @param props - The props to watch and sync
 * 
 * @example
 * ```tsx
 * function MyButton({ label, disabled }: Props) {
 *   useRegisterUIComponentWithProps<ButtonComponent>(
 *     {
 *       id: 'my-button',
 *       type: 'button',
 *       label,
 *       disabled
 *     },
 *     { label, disabled }
 *   );
 * 
 *   return <button>{label}</button>;
 * }
 * ```
 */
export function useRegisterUIComponentWithProps<T extends UIComponent>(
  component: T,
  props: MetadataProps<T>
) {
  const updateMetadata = useRegisterUIComponent(component);

  // Update metadata whenever props change
  useEffect(() => {
    updateMetadata(props as Partial<T>);
  }, [props, updateMetadata]);

  return updateMetadata;
}
