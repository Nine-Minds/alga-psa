'use client';

import { useEffect, useRef, useCallback, useContext } from 'react';
import { useUIState, UIStateContext } from './UIStateContext';
import { UIComponent, ComponentAction } from './types';
import { CommonActions } from './actionBuilders';

/**
 * Generate default actions based on component type for backward compatibility.
 */
function getDefaultActionsForType(type: string, label?: string): ComponentAction[] {
  switch (type) {
    case 'button':
      return [
        CommonActions.click(label ? `Click ${label}` : 'Click this button'),
        CommonActions.focus('Focus this button')
      ];
    case 'formField':
      return [
        CommonActions.type('Type text into this field'),
        CommonActions.focus('Focus this field'),
        CommonActions.clear('Clear the field')
      ];
    case 'container':
    case 'card':
    case 'dialog':
      return [
        CommonActions.focus('Focus this container')
      ];
    case 'navigation':
      return [
        CommonActions.click('Navigate using this menu'),
        CommonActions.focus('Focus this navigation')
      ];
    default:
      return [
        CommonActions.focus('Focus this element')
      ];
  }
}

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
): (partial: Partial<T>) => void {
  // Check if UIStateProvider is available
  const context = useContext(UIStateContext);
  const hasProvider = context !== undefined && typeof context.registerComponent === 'function';

  // Only use UIState if provider is available
  const { registerComponent, unregisterComponent, updateComponent } = hasProvider
    ? context
    : {
        registerComponent: () => {},
        unregisterComponent: () => {},
        updateComponent: () => {}
      };

  // Keep a ref to the latest component for the cleanup function
  const componentRef = useRef(component);
  componentRef.current = component;

  // Register on mount, unregister on unmount
  useEffect(() => {
    // Skip if no provider available
    if (!hasProvider) {
      return;
    }

    // Skip registration for components with special prefix
    if (component.id.startsWith('__skip_registration_')) {
      return; // Don't register, but also don't need cleanup
    }

    // Add default actions if none are provided (for backward compatibility)
    const componentWithActions = {
      ...component,
      actions: component.actions || getDefaultActionsForType(component.type, component.label)
    };

    const componentToRegister = parentId ? { ...componentWithActions, parentId } : componentWithActions;
    registerComponent(componentToRegister);

    return () => {
      unregisterComponent(componentRef.current.id);
    };
  }, [registerComponent, unregisterComponent, parentId, hasProvider]);

  /**
   * Update the component's metadata in the UI state
   * Memoized to allow usage in effect dependencies
   */
  const updateMetadata = useCallback(
    (partial: Partial<T>) => {
      // Skip if no provider available
      if (!hasProvider) {
        return;
      }

      // Validate that we're not changing the component type
      if (partial.type && partial.type !== component.type) {
        console.warn(
          `Cannot change component type from ${component.type} to ${partial.type}`
        );
        return;
      }

      updateComponent(component.id, partial);
    },
    [component.id, component.type, updateComponent, hasProvider]
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
): (partial: Partial<T>) => void {
  return useRegisterUIComponent(component, parentId);
}

export function useRegisterUIComponentWithProps<T extends UIComponent>(
  component: T,
  props: MetadataProps<T>,
  parentId?: string
): (partial: Partial<T>) => void {
  const updateMetadata = useRegisterUIComponent(component, parentId);

  // Update metadata whenever props change
  useEffect(() => {
    updateMetadata(props as Partial<T>);
  }, [props, updateMetadata]);

  return updateMetadata;
}
