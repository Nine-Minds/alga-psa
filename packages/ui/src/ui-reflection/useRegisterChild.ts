'use client';

import { useEffect } from 'react';
import { useReflectionParent } from './ReflectionParentContext';
import { useRegisterUIComponent } from './useRegisterUIComponent';
import { UIComponent } from './types';

let childRegistrationCounter = 0;

/**
 * Like useRegisterUIComponent, but automatically sets parentId
 * from ReflectionParentContext so you don't have to do it manually.
 * 
 * @template T - The specific component type (extends UIComponent)
 * @param component - The component's metadata to register
 * @returns A function to update the component's metadata
 * 
 * @example
 * ```tsx
 * function ClientPicker({ dialogId }: Props) {
 *   const updatePicker = useRegisterChild<ContainerComponent>({
 *     id: `${dialogId}-client-picker`,
 *     type: 'container',
 *     label: 'Client Picker'
 *   });
 *   
 *   return <div>...</div>;
 * }
 * ```
 */
export function useRegisterChild<T extends UIComponent>(component: T): (partial: Partial<T>) => void {
  const parentId = useReflectionParent() ?? undefined;
  const updateMetadata = useRegisterUIComponent<T>(component, parentId);

  return updateMetadata;
}

/**
 * Helper hook that combines useRegisterChild with automatic prop updates
 * 
 * @template T - The specific component type
 * @param component - The component's metadata
 * @param props - The props to watch and sync with metadata
 * 
 * @example
 * ```tsx
 * function ClientPicker({ dialogId, label, disabled }: Props) {
 *   useRegisterChildWithProps<ContainerComponent>(
 *     {
 *       id: `${dialogId}-client-picker`,
 *       type: 'container',
 *       label,
 *       disabled
 *     },
 *     { label, disabled }
 *   );
 *   
 *   return <div>...</div>;
 * }
 * ```
 */
export function useRegisterChildWithProps<T extends UIComponent>(
  component: T,
  props: Partial<Omit<T, 'id' | 'type'>>
): (partial: Partial<T>) => void {
  const registrationId = `child_props_${Date.now()}_${++childRegistrationCounter}`;
  const updateMetadata = useRegisterChild(component);

  // Update metadata whenever props change
  useEffect(() => {
    updateMetadata(props as Partial<T>);
  }, [props, updateMetadata, component.id, registrationId]);

  return updateMetadata;
}
