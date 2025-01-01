'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useUIState } from './UIStateContext';
import { UIComponent } from './types';

/**
 * Custom hook for registering UI components with the reflection system.
 * 
 * @template T - The specific component type (extends UIComponent)
 * @param component - The component's metadata to register
 * @param parentId - Optional ID of the parent component for hierarchical relationships
 * @returns A function to update the component's metadata
 * 
 * @example
 * ```tsx
 * // As a top-level component
 * function MyButton({ label, disabled }: Props) {
 *   const updateMetadata = useRegisterUIComponent<ButtonComponent>({
 *     id: 'my-button',
 *     type: 'button',
 *     label,
 *     disabled
 *   });
 * 
 *   return <button>{label}</button>;
 * }
 * 
 * // As a child component
 * function DialogButton({ dialogId, label }: Props) {
 *   const updateMetadata = useRegisterUIComponent<ButtonComponent>(
 *     {
 *       id: 'dialog-button',
 *       type: 'button',
 *       label
 *     },
 *     dialogId // Parent component ID
 *   );
 * 
 *   return <button>{label}</button>;
 * }
 * ```
 */
export function useRegisterUIComponent<T extends UIComponent>(
  component: T,
  parentId?: string
) {
  const { registerComponent, unregisterComponent, updateComponent } = useUIState();
  
  // Keep a ref to the latest component for the cleanup function
  const componentRef = useRef(component);
  componentRef.current = component;

  // Register on mount, unregister on unmount
  useEffect(() => {
    const componentToRegister = parentId ? { ...component, parentId } : component;
    registerComponent(componentToRegister);

    return () => {
      unregisterComponent(componentRef.current.id);
    };
  }, [registerComponent, unregisterComponent, parentId]);

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
/**
 * Custom hook for registering child components with implicit parent-child relationships.
 * 
 * @template T - The specific component type (extends UIComponent)
 * @param parentId - ID of the parent component
 * @param component - The child component's metadata to register
 * @returns A function to update the component's metadata
 * 
 * @example
 * ```tsx
 * function DialogContent({ dialogId }: Props) {
 *   const updateButton = useRegisterChildComponent<ButtonComponent>(
 *     dialogId,
 *     {
 *       id: 'dialog-button',
 *       type: 'button',
 *       label: 'Close'
 *     }
 *   );
 * 
 *   return <button>Close</button>;
 * }
 * ```
 */
export function useRegisterChildComponent<T extends UIComponent>(
  parentId: string,
  component: T
) {
  return useRegisterUIComponent(component, parentId);
}

export function useRegisterUIComponentWithProps<T extends UIComponent>(
  component: T,
  props: MetadataProps<T>,
  parentId?: string
) {
  const updateMetadata = useRegisterUIComponent(component, parentId);

  // Update metadata whenever props change
  useEffect(() => {
    updateMetadata(props as Partial<T>);
  }, [props, updateMetadata]);

  return updateMetadata;
}
