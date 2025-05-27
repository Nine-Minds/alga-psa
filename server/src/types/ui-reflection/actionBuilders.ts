/**
 * Action Builders for UI Components
 * 
 * This module provides utility functions for building component actions
 * in a consistent and type-safe manner.
 */

import { ComponentAction, ActionParameter, ActionType } from './types';

/**
 * Builder class for creating component actions with fluent API.
 */
export class ActionBuilder {
  private action: Partial<ComponentAction>;

  constructor(type: ActionType) {
    this.action = {
      type,
      available: true,
      description: '',
      parameters: [],
      prerequisites: []
    };
  }

  /**
   * Set the availability of the action.
   */
  available(isAvailable: boolean): ActionBuilder {
    this.action.available = isAvailable;
    return this;
  }

  /**
   * Set the description of the action.
   */
  description(desc: string): ActionBuilder {
    this.action.description = desc;
    return this;
  }

  /**
   * Add a parameter to the action.
   */
  parameter(param: ActionParameter): ActionBuilder {
    if (!this.action.parameters) {
      this.action.parameters = [];
    }
    this.action.parameters.push(param);
    return this;
  }

  /**
   * Add a string parameter.
   */
  stringParam(name: string, description: string, required = true, defaultValue?: string): ActionBuilder {
    return this.parameter({
      name,
      type: 'string',
      required,
      description,
      defaultValue
    });
  }

  /**
   * Add an option parameter with choices.
   */
  optionParam(name: string, description: string, options: string[], required = true, defaultValue?: string): ActionBuilder {
    return this.parameter({
      name,
      type: 'option',
      required,
      options,
      description,
      defaultValue
    });
  }

  /**
   * Add a boolean parameter.
   */
  booleanParam(name: string, description: string, required = false, defaultValue?: boolean): ActionBuilder {
    return this.parameter({
      name,
      type: 'boolean',
      required,
      description,
      defaultValue
    });
  }

  /**
   * Add a prerequisite action that must be completed first.
   */
  prerequisite(actionType: ActionType): ActionBuilder {
    if (!this.action.prerequisites) {
      this.action.prerequisites = [];
    }
    this.action.prerequisites.push(actionType);
    return this;
  }

  /**
   * Build the final action.
   */
  build(): ComponentAction {
    return this.action as ComponentAction;
  }
}

/**
 * Create a new action builder.
 */
export function createAction(type: ActionType): ActionBuilder {
  return new ActionBuilder(type);
}

/**
 * Common action builders for standard UI patterns.
 */
export const CommonActions = {
  /**
   * Standard click action.
   */
  click(description = 'Click this element'): ComponentAction {
    return createAction('click')
      .description(description)
      .build();
  },

  /**
   * Type text action.
   */
  type(description = 'Type text into this field'): ComponentAction {
    return createAction('type')
      .description(description)
      .stringParam('text', 'Text to type into the field')
      .build();
  },

  /**
   * Select from options action.
   */
  select(options: string[] = [], description = 'Select an option'): ComponentAction {
    return createAction('select')
      .description(description)
      .optionParam('option', 'Option to select', options)
      .build();
  },

  /**
   * Focus action.
   */
  focus(description = 'Focus this element'): ComponentAction {
    return createAction('focus')
      .description(description)
      .build();
  },

  /**
   * Open action (for dropdowns, dialogs, etc.).
   */
  open(description = 'Open this element'): ComponentAction {
    return createAction('open')
      .description(description)
      .build();
  },

  /**
   * Close action.
   */
  close(description = 'Close this element'): ComponentAction {
    return createAction('close')
      .description(description)
      .build();
  },

  /**
   * Clear action for inputs.
   */
  clear(description = 'Clear the current value'): ComponentAction {
    return createAction('clear')
      .description(description)
      .build();
  },

  /**
   * Search action for searchable components.
   */
  search(description = 'Search for items'): ComponentAction {
    return createAction('search')
      .description(description)
      .stringParam('query', 'Search query')
      .build();
  }
};

/**
 * Action builder for dynamic select components (like pickers).
 */
export function createDynamicSelectAction(
  isOpen: boolean,
  options: string[] = [],
  description = 'Select an option from the dropdown'
): ComponentAction {
  return createAction('select')
    .description(description)
    .available(isOpen)
    .optionParam('option', 'Option to select', options)
    .prerequisite('open')
    .build();
}

/**
 * Action builder for conditional actions based on component state.
 */
export function createConditionalAction(
  type: ActionType,
  condition: boolean,
  description: string
): ComponentAction {
  return createAction(type)
    .description(description)
    .available(condition)
    .build();
}