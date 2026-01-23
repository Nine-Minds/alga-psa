'use client';

import { UIComponent, ComponentAction } from './types';
import { useRegisterChild } from './useRegisterChild';
import { useContext, useRef, useMemo, useId } from 'react';
import { ReflectionParentContext } from './ReflectionParentContext';
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
 * Type for action configuration in components.
 */
export type ActionConfig = ComponentAction[] | (() => ComponentAction[]);

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
 * - Dynamic action configuration
 * 
 * @template T - The specific component type (extends UIComponent)
 * @param component - The component's metadata to register (without actions)
 * @param actions - The actions configuration (array or function returning array)
 * @param overrideId - Optional ID override
 * @returns Object containing automation ID props and metadata update function
 * 
 * @example
 * ```tsx
 * // With static actions
 * const { automationIdProps } = useAutomationIdAndRegister<ButtonComponent>({
 *   type: 'button',
 *   label: 'Submit'
 * }, [CommonActions.click()]);
 * 
 * // With dynamic actions
 * const { automationIdProps } = useAutomationIdAndRegister<FormFieldComponent>({
 *   type: 'formField',
 *   fieldType: 'select'
 * }, () => [
 *   CommonActions.open(),
 *   createDynamicSelectAction(isOpen, options)
 * ]);
 * ```
 */
export function useAutomationIdAndRegister<T extends UIComponent>(
  component: Omit<T, 'id' | 'actions'> & { id?: string },
  actionsOrShouldRegister: ActionConfig | boolean = [],
  overrideId?: string
): {
  automationIdProps: { id: string; 'data-automation-id': string };
  updateMetadata: (partial: Partial<T>) => void;
  updateActions: (newActions: ActionConfig) => void;
} {
  if (!component.parentId) {
    component.parentId = undefined;
  }
  if (!component.label) {
    component.label = undefined;
  }

  // Generate a stable React ID for this component instance
  const reactId = useId();
  
  // Generate a unique registration ID for tracking this specific registration
  const registrationId = useRef(generateRegistrationId());
  // Get parent ID from context
  const parentId = useContext(ReflectionParentContext);

  // Use override ID if provided, otherwise use stable React ID-based format
  const finalId = overrideId || component.id || (parentId ? `${parentId}-${component.type}-${reactId}` : `${component.type}-${reactId}`);

  // Handle backward compatibility: if boolean is passed, treat as empty actions
  const actions: ActionConfig = typeof actionsOrShouldRegister === 'boolean' ? [] : actionsOrShouldRegister;
  
  // Track current actions configuration
  const actionsRef = useRef<ActionConfig>(actions);
  actionsRef.current = actions;

  // Compute actions dynamically
  const computedActions = useMemo(() => {
    let actionsList: ComponentAction[];
    if (typeof actionsRef.current === 'function') {
      actionsList = actionsRef.current();
    } else {
      actionsList = actionsRef.current || [];
    }
    
    // If no actions provided, use default actions for backward compatibility
    if (actionsList.length === 0) {
      return getDefaultActionsForType(component.type, component.label);
    }
    
    return actionsList;
  }, [actionsRef.current, component.type, component.label]);

  // Always register, but use the final ID (either provided or generated)
  const componentToRegister = {
    ...component,
    id: finalId,
    actions: computedActions
  } as T;
  
  const updateMetadata = useRegisterChild<T>(componentToRegister);

  // Function to update actions dynamically
  const updateActions = (newActions: ActionConfig) => {
    actionsRef.current = newActions;
    const newComputedActions = typeof newActions === 'function' ? newActions() : newActions;
    updateMetadata({ actions: newComputedActions } as Partial<T>);
  };

  // Generate automation props
  const automationIdProps = {
    id: finalId,
    'data-automation-id': finalId,
  };

  return { automationIdProps, updateMetadata, updateActions };
}
