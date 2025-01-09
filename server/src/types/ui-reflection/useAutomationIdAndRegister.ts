'use client';

import { UIComponent } from './types';
import { useRegisterChild } from './useRegisterChild';
import { useContext, useRef } from 'react';
import { ReflectionParentContext } from './ReflectionParentContext';

// Keep a module-level counter for auto-generated IDs and registration tracking
let autoIdCounter = 0;
let registrationCounter = 0;

/**
 * Generates a unique registration ID for tracking component registrations
 */
function generateRegistrationId(): string {
  registrationCounter++;
  return `reg_${Date.now()}_${registrationCounter}`;
}

/**
 * Generates a unique ID for a component when none is provided
 * @param type The component type (e.g., 'container', 'button', etc.)
 * @returns A unique auto-generated ID
 */
function generateAutoId(type: string, registrationId: string): string {
  autoIdCounter++;
  return `${type}-${autoIdCounter}`;
}

/**
 * Formats component IDs according to naming conventions:
 * - Screen/Page: my-screen
 * - Subcontainer: ${parentId}-section (e.g., my-screen-filters)
 * - Component: ${parentId}-type (e.g., my-screen-filters-select)
 * 
 * @param id The provided or auto-generated ID
 * @param parentId The parent component's ID from context
 * @param type The component type
 * @param registrationId Unique ID for tracking this registration
 * @returns Properly formatted component ID
 */
function formatComponentId(
  id: string | undefined, 
  parentId: string | null, 
  type: string,
  registrationId: string
): string {


  if (id) {
    return id;
  }

  // If no parent, this is likely a page/screen component
  if (!parentId) {
    const generatedId = generateAutoId(type, registrationId);
    return generatedId;
  }

  // For child components, include parent ID in the auto-generated ID
  const generatedId = `${parentId}-${generateAutoId(type, registrationId)}`;
  return generatedId;
}

/**
 * Custom hook that combines UI reflection registration and data-automation-id props.
 * This ensures a single source of truth for component IDs, preventing mismatches
 * between reflection system registration and DOM attributes.
 * 
 * Features:
 * - Automatic ID generation if none provided
 * - Consistent ID formatting based on component hierarchy
 * - Parent-child relationship tracking
 * - Unified data-automation-id attributes
 * 
 * @template T - The specific component type (extends UIComponent)
 * @param component - The component's metadata to register
 * @returns Object containing automation ID props and metadata update function
 * 
 * @example
 * ```tsx
 * // With explicit ID
 * const { automationIdProps } = useAutomationIdAndRegister<ContainerComponent>({
 *   id: `${parentId}-filters`,
 *   type: 'container',
 *   label: 'Filters Section'
 * });
 * 
 * // With auto-generated ID
 * const { automationIdProps } = useAutomationIdAndRegister<ContainerComponent>({
 *   type: 'container',
 *   label: 'Filters Section'
 * });
 * ```
 */
export function useAutomationIdAndRegister<T extends UIComponent>(
  component: Omit<T, 'id'> & { id?: string }
): {
  automationIdProps: { id: string; 'data-automation-id': string };
  updateMetadata: (partial: Partial<T>) => void;
} {
  if (!component.parentId) {
    component.parentId = undefined;
  }
  if (!component.label) {
    component.label = undefined;
  }

  // Generate a unique registration ID for tracking this specific registration
  const registrationId = useRef(generateRegistrationId());
  // Get parent ID from context
  const parentId = useContext(ReflectionParentContext);

  // Generate or format component ID
  const formattedId = formatComponentId(
    component.id, 
    parentId, 
    component.type,
    registrationId.current
  );

  // Register with reflection system
  const updateMetadata = useRegisterChild<T>({
    ...component,
    id: formattedId
  } as T);

  // Generate automation props
  const automationIdProps = {
    id: formattedId,
    'data-automation-id': formattedId,
  };

  return { automationIdProps, updateMetadata };
}
