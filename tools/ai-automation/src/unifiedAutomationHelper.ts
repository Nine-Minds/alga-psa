import type { Page } from 'puppeteer';
import { ComponentAction, ActionResult, ActionParameter } from './types/ui-reflection-types.js';

/**
 * Parameters for executing an action.
 */
export interface ActionExecutionParams {
  [paramName: string]: any;
}

/**
 * Unified automation helper that provides a single interface for all UI interactions.
 * This replaces the multiple specialized helper methods with a consistent execute() approach.
 */
export class UnifiedAutomationHelper {
  constructor(private page: Page) {}

  /**
   * Execute an action on a UI component.
   * 
   * @param elementId - The automation ID of the target element
   * @param actionType - The action to perform (e.g., 'click', 'type', 'select')
   * @param params - Parameters for the action
   * @returns Promise<ActionResult>
   */
  async execute(elementId: string, actionType: string, params: ActionExecutionParams = {}): Promise<ActionResult> {
    console.log(`[UnifiedHelper] Executing action: ${actionType} on element: ${elementId}`);
    
    try {
      // Special case for navigation - doesn't need an element
      if (actionType === 'navigate') {
        return await this.executeNavigate(params.url || '');
      }

      // Find the element using both modern and legacy attributes
      const element = await this.findElement(elementId);
      if (!element) {
        return {
          success: false,
          error: `Could not find element with id: ${elementId}`
        };
      }

      // Get the component's available actions from UI state
      const availableActions = await this.getAvailableActions(elementId);
      const targetAction = availableActions.find(action => action.type === actionType);

      if (!targetAction) {
        return {
          success: false,
          error: `Action '${actionType}' is not available for element '${elementId}'. Available actions: ${availableActions.map(a => a.type).join(', ')}`
        };
      }

      if (!targetAction.available) {
        // Check if action has prerequisites
        if (targetAction.prerequisites && targetAction.prerequisites.length > 0) {
          console.log(`[UnifiedHelper] Action '${actionType}' requires prerequisites: ${targetAction.prerequisites.join(', ')}`);
          
          // Automatically execute prerequisites
          for (const prerequisite of targetAction.prerequisites) {
            console.log(`[UnifiedHelper] Executing prerequisite: ${prerequisite}`);
            const prereqResult = await this.execute(elementId, prerequisite);
            if (!prereqResult.success) {
              return {
                success: false,
                error: `Failed to execute prerequisite '${prerequisite}': ${prereqResult.error}`
              };
            }
            
            // Wait a moment for the prerequisite to take effect
            await new Promise(resolve => setTimeout(resolve, 200));
          }
          
          // Re-check action availability after prerequisites
          const updatedActions = await this.getAvailableActions(elementId);
          const updatedAction = updatedActions.find(action => action.type === actionType);
          if (!updatedAction?.available) {
            return {
              success: false,
              error: `Action '${actionType}' is still not available after executing prerequisites`
            };
          }
        } else {
          return {
            success: false,
            error: `Action '${actionType}' is not currently available for element '${elementId}'`
          };
        }
      }

      // Validate parameters
      const validationResult = this.validateParameters(targetAction, params);
      if (!validationResult.success) {
        return validationResult;
      }

      // Execute the action
      const result = await this.executeAction(elementId, actionType, params);
      
      console.log(`[UnifiedHelper] Action '${actionType}' executed successfully on '${elementId}'`);
      return result;

    } catch (error: any) {
      console.error(`[UnifiedHelper] Error executing action '${actionType}' on '${elementId}':`, error);
      return {
        success: false,
        error: error.message || 'Unknown error occurred'
      };
    }
  }

  /**
   * Get the available actions for a component by querying the UI state.
   */
  async getAvailableActions(elementId: string): Promise<ComponentAction[]> {
    try {
      // Get UI state from the page
      const actions = await this.page.evaluate((id) => {
        // @ts-ignore - UI state is injected by the automation platform
        const uiState = window.__UI_STATE__;
        if (!uiState || !uiState.components) {
          return [];
        }

        // Recursively search for component with matching ID
        function findComponent(components: any[]): any {
          for (const component of components) {
            if (component.id === id) {
              return component;
            }
            if (component.children) {
              const found = findComponent(component.children);
              if (found) return found;
            }
          }
          return null;
        }

        const component = findComponent(uiState.components);
        return component?.actions || [];
      }, elementId);

      return actions;
    } catch (error) {
      console.warn(`[UnifiedHelper] Could not get actions for element '${elementId}':`, error);
      return [];
    }
  }

  /**
   * Query component state and metadata.
   */
  async query(elementId?: string): Promise<any> {
    try {
      const result = await this.page.evaluate((id) => {
        // @ts-ignore - UI state is injected by the automation platform
        const uiState = window.__UI_STATE__;
        
        if (!id) {
          // Return full UI state if no element ID specified
          return uiState;
        }

        // Find specific component
        function findComponent(components: any[]): any {
          for (const component of components) {
            if (component.id === id) {
              return component;
            }
            if (component.children) {
              const found = findComponent(component.children);
              if (found) return found;
            }
          }
          return null;
        }

        if (!uiState || !uiState.components) {
          return null;
        }

        return findComponent(uiState.components);
      }, elementId);

      return result;
    } catch (error) {
      console.error(`[UnifiedHelper] Error querying component state:`, error);
      return null;
    }
  }

  /**
   * Wait for a condition to be met.
   */
  async wait(condition: string | (() => Promise<boolean>), timeout = 30000): Promise<ActionResult> {
    try {
      if (condition === 'navigation') {
        console.log('[UnifiedHelper] Waiting for navigation to complete');
        await this.page.waitForNetworkIdle({ idleTime: 500, timeout });
        return { success: true };
      }

      if (typeof condition === 'function') {
        // Custom condition function
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
          if (await condition()) {
            return { success: true };
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        return {
          success: false,
          error: `Condition not met within ${timeout}ms`
        };
      }

      return {
        success: false,
        error: `Unsupported wait condition: ${condition}`
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Wait operation failed'
      };
    }
  }

  /**
   * Find an element using both modern and legacy attributes.
   */
  private async findElement(elementId: string) {
    try {
      // Try data-automation-id first (modern)
      console.log(`[UnifiedHelper] Trying data-automation-id="${elementId}"`);
      return await this.page.waitForSelector(`[data-automation-id="${elementId}"]`, { timeout: 5000 });
    } catch (error) {
      try {
        // Fallback to id attribute (legacy)
        console.log(`[UnifiedHelper] data-automation-id not found, trying id="${elementId}"`);
        return await this.page.waitForSelector(`[id="${elementId}"]`, { timeout: 5000 });
      } catch (fallbackError) {
        console.error(`[UnifiedHelper] Element not found with either attribute: ${elementId}`);
        return null;
      }
    }
  }

  /**
   * Validate action parameters against the action definition.
   */
  private validateParameters(action: ComponentAction, params: ActionExecutionParams): ActionResult {
    if (!action.parameters || action.parameters.length === 0) {
      return { success: true };
    }

    for (const paramDef of action.parameters) {
      const value = params[paramDef.name];
      
      if (paramDef.required && (value === undefined || value === null)) {
        return {
          success: false,
          error: `Missing required parameter: ${paramDef.name}. ${paramDef.description}`
        };
      }

      if (value !== undefined && paramDef.type === 'option' && paramDef.options) {
        if (!paramDef.options.includes(value)) {
          return {
            success: false,
            error: `Invalid option for ${paramDef.name}. Expected one of: ${paramDef.options.join(', ')}`
          };
        }
      }
    }

    return { success: true };
  }

  /**
   * Execute a specific action type.
   */
  private async executeAction(elementId: string, actionType: string, params: ActionExecutionParams): Promise<ActionResult> {
    switch (actionType) {
      case 'click':
        return await this.executeClick(elementId);
      case 'type':
        return await this.executeType(elementId, params.text);
      case 'select':
        return await this.executeSelect(elementId, params.option);
      case 'focus':
        return await this.executeFocus(elementId);
      case 'open':
        return await this.executeOpen(elementId);
      case 'close':
        return await this.executeClose(elementId);
      case 'clear':
        return await this.executeClear(elementId);
      case 'search':
        return await this.executeSearch(elementId, params.query);
      case 'navigate':
        return await this.executeNavigate(params.url);
      default:
        return {
          success: false,
          error: `Unsupported action type: ${actionType}`
        };
    }
  }

  private async executeClick(elementId: string): Promise<ActionResult> {
    const element = await this.findElement(elementId);
    if (!element) {
      return { success: false, error: `Element not found: ${elementId}` };
    }

    await element.click();
    return { success: true };
  }

  private async executeType(elementId: string, text: string): Promise<ActionResult> {
    const element = await this.findElement(elementId);
    if (!element) {
      return { success: false, error: `Element not found: ${elementId}` };
    }

    // Clear existing content and type new text
    await element.click();
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Clear the field
    await element.click({ clickCount: 3 });
    await element.evaluate((el: any) => {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    
    await element.type(text);
    return { success: true };
  }

  private async executeSelect(elementId: string, option: string): Promise<ActionResult> {
    // Delegate to the existing sophisticated select logic
    const parentSelector = `[data-automation-id="${elementId}"],[id="${elementId}"]`;
    
    const automationType = await this.page.evaluate((selector) => {
      const element = document.querySelector(selector);
      return element?.getAttribute('data-automation-type') || 'standard';
    }, parentSelector);

    // Use existing select implementation based on type
    try {
      switch (automationType) {
        case 'picker':
          await this.selectPicker(parentSelector, option);
          break;
        case 'user-picker':
          await this.selectUserPicker(parentSelector, option);
          break;
        default:
          await this.selectStandard(parentSelector, option);
          break;
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async executeFocus(elementId: string): Promise<ActionResult> {
    const element = await this.findElement(elementId);
    if (!element) {
      return { success: false, error: `Element not found: ${elementId}` };
    }

    await element.focus();
    return { success: true };
  }

  private async executeOpen(elementId: string): Promise<ActionResult> {
    // Open is typically a click action for dropdowns, dialogs, etc.
    return await this.executeClick(elementId);
  }

  private async executeClose(elementId: string): Promise<ActionResult> {
    // Close could be clicking a close button or pressing Escape
    const element = await this.findElement(elementId);
    if (!element) {
      return { success: false, error: `Element not found: ${elementId}` };
    }

    await element.click();
    return { success: true };
  }

  private async executeClear(elementId: string): Promise<ActionResult> {
    const element = await this.findElement(elementId);
    if (!element) {
      return { success: false, error: `Element not found: ${elementId}` };
    }

    await element.click({ clickCount: 3 });
    await this.page.keyboard.press('Delete');
    return { success: true };
  }

  private async executeSearch(elementId: string, query: string): Promise<ActionResult> {
    // Search is typically typing into a search field
    return await this.executeType(elementId, query);
  }

  private async executeNavigate(url: string): Promise<ActionResult> {
    await this.page.goto(url);
    await this.wait('navigation');
    return { success: true };
  }

  // Include the existing sophisticated select implementations
  private async selectStandard(parentSelector: string, optionValue: string) {
    // Check if this is a Radix Select (CustomSelect) vs native HTML select
    const hasNativeSelect = await this.page.evaluate((selector) => {
      const element = document.querySelector(selector);
      return !!element?.querySelector('select');
    }, parentSelector);

    if (!hasNativeSelect) {
      console.log('[UnifiedHelper] No native select found, treating as Radix Select');
      return await this.selectRadixSelect(parentSelector, optionValue);
    }

    // Handle native HTML select
    const selectSelector = `${parentSelector} select`;
    const options = await this.page.evaluate((selector, targetValue) => {
      const select = document.querySelector(selector) as HTMLSelectElement;
      Array.from(select.options).forEach(option => {
        console.log('[UnifiedHelper::selectStandard] Option:', option.value, option.text);
      });

      return {
        index: Array.from(select.options).findIndex(option => option.value === targetValue || option.text === targetValue),
        size: select.options.length
      };
    }, selectSelector, optionValue);
    
    if (options.index === -1) {
      throw new Error(`Option "${optionValue}" not found in select options`);
    }

    await this.page.click(`${parentSelector}`);

    // Reset selection position
    for(let i = 0; i < options.size; i++) {
      await this.page.keyboard.press('ArrowUp');
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    for (let i = 0; i < options.index; i++) {
      await this.page.keyboard.press('ArrowDown');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await this.page.keyboard.press('Enter');
    return true;
  }

  private async selectRadixSelect(parentSelector: string, optionValue: string) {
    console.log('[UnifiedHelper] Selecting Radix Select option:', { parentSelector, optionValue });
    
    // Click the trigger to open the dropdown
    const triggerSelector = `${parentSelector} button[aria-haspopup="listbox"], ${parentSelector} [data-radix-select-trigger]`;
    console.log('[UnifiedHelper] Clicking trigger:', triggerSelector);
    await this.page.click(triggerSelector);
    
    // Wait for the dropdown content to appear
    console.log('[UnifiedHelper] Waiting for dropdown content...');
    await Promise.race([
      this.page.waitForSelector('[data-radix-select-content]', { timeout: 5000 }),
      this.page.waitForSelector('[role="listbox"]', { timeout: 5000 }),
      this.page.waitForSelector('[data-radix-collection-item]', { timeout: 5000 })
    ]);
    console.log('[UnifiedHelper] Dropdown content visible');
    
    // Find and click the option by value or text (case insensitive)
    const optionSelected = await this.page.evaluate((targetValue) => {
      const selectors = [
        '[data-radix-select-item]',
        '[role="option"]', 
        '[data-radix-collection-item]',
        'div[data-value]'
      ];
      
      let allOptions: Element[] = [];
      for (const selector of selectors) {
        const options = Array.from(document.querySelectorAll(selector));
        if (options.length > 0) {
          allOptions = options;
          console.log(`[UnifiedHelper] Found ${options.length} options using selector: ${selector}`);
          break;
        }
      }
      
      if (allOptions.length === 0) {
        console.log('[UnifiedHelper] No options found with any selector');
        return false;
      }
      
      const targetLower = targetValue.toLowerCase();
      
      for (const option of allOptions) {
        const value = (option.getAttribute('data-value') || '').toLowerCase();
        const text = (option.textContent?.trim() || '').toLowerCase();
        
        console.log('[UnifiedHelper] Checking option:', { 
          value, 
          text, 
          targetValue: targetLower,
          element: option.outerHTML.substring(0, 100) + '...'
        });
        
        if (value === targetLower || text === targetLower) {
          console.log('[UnifiedHelper] Found matching option, clicking');
          (option as HTMLElement).click();
          return true;
        }
      }
      return false;
    }, optionValue);
    
    if (!optionSelected) {
      throw new Error(`Option "${optionValue}" not found in Radix Select dropdown`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 200));
    console.log('[UnifiedHelper] Radix Select option selected successfully');
    return true;
  }

  private async selectUserPicker(parentSelector: string, optionValue: string) {
    console.log('[UnifiedHelper] Starting UserPicker selection', {
      parentSelector,
      optionValue
    });

    // Check if dropdown is already open by looking for options
    const isAlreadyOpen = await this.page.evaluate(() => {
      return !!document.querySelector('div[class*="cursor-pointer"][class*="hover:bg-gray-100"]');
    });

    if (!isAlreadyOpen) {
      // Click the picker button to open dropdown
      const toggleElement = await this.page.waitForSelector(parentSelector);
      if (!toggleElement) {
        throw new Error(`Could not find UserPicker element with selector: ${parentSelector}`);
      }

      console.log('[UnifiedHelper] Clicking UserPicker to open dropdown...');
      await toggleElement.click();
      
      // Wait for dropdown options to appear
      console.log('[UnifiedHelper] Waiting for UserPicker dropdown options...');
      try {
        await this.page.waitForSelector('div[class*="cursor-pointer"][class*="hover:bg-gray-100"]', { timeout: 3000 });
      } catch {
        throw new Error('Could not find UserPicker dropdown options after opening');
      }
    } else {
      console.log('[UnifiedHelper] UserPicker dropdown already open');
    }

    console.log('[UnifiedHelper] UserPicker dropdown opened, looking for options...');

    // Find and click the matching option
    const optionSelected = await this.page.evaluate((targetValue) => {
      const options = Array.from(document.querySelectorAll('div[class*="cursor-pointer"][class*="hover:bg-gray-100"]'));
      
      console.log('[UnifiedHelper] Found UserPicker options:', options.length);
      
      for (const option of options) {
        const text = option.textContent?.trim() || '';
        console.log('[UnifiedHelper] Checking option text:', text);
        
        if (text === targetValue || text.toLowerCase() === targetValue.toLowerCase()) {
          console.log('[UnifiedHelper] Found matching UserPicker option:', text);
          (option as HTMLElement).click();
          return true;
        }
        
        if (text.toLowerCase().includes(targetValue.toLowerCase())) {
          console.log('[UnifiedHelper] Found partial matching UserPicker option:', text);
          (option as HTMLElement).click();
          return true;
        }
      }
      
      console.log('[UnifiedHelper] No matching UserPicker option found for:', targetValue);
      return false;
    }, optionValue);

    if (!optionSelected) {
      throw new Error(`Could not find UserPicker option with text "${optionValue}"`);
    }

    console.log('[UnifiedHelper] UserPicker option selected successfully');
    return true;
  }

  private async selectPicker(parentSelector: string, optionValue: string) {
    console.log('[UnifiedHelper] Starting company picker selection', {
      parentSelector,
      optionValue
    });

    let toggleElement;

    if (parentSelector.endsWith('-toggle')) {
      console.log('[UnifiedHelper] Parent selector ends with -toggle, finding parent element...');
      toggleElement = await this.page.waitForSelector(parentSelector);
      if (!toggleElement) {
        throw new Error(`Could not find toggle element with selector: ${parentSelector}`);
      }

      const parentId = await toggleElement.evaluate(el => el.parentElement?.id);
      if (!parentId) {
        throw new Error('Could not find parent element ID');
      }

      parentSelector = `#${parentId}`;
      console.log('[UnifiedHelper] Updated parent selector:', parentSelector);
    } else {
      const toggleId = parentSelector.replaceAll(/company-picker-company-picker/g, 'company-picker-toggle');
      console.log('[UnifiedHelper] Generated toggle ID:', toggleId);

      console.log('[UnifiedHelper] Waiting for toggle element...');
      toggleElement = await this.page.waitForSelector(toggleId);
      if (!toggleElement) {
        console.error('[UnifiedHelper] Toggle element not found');
        throw new Error(`Could not find toggle element with selector: ${toggleId}`);
      }
    }

    console.log('[UnifiedHelper] Found toggle element');

    // Check for adjacent div sibling
    const hasDivSibling = await toggleElement.evaluate(el => {
      const nextSibling = el.nextElementSibling;
      return nextSibling && nextSibling.tagName.toLowerCase() === 'div';
    });

    console.log('[UnifiedHelper] Toggle element has adjacent div sibling:', hasDivSibling);

    // Click toggle
    if (!hasDivSibling) {
      console.log('[UnifiedHelper] Clicking toggle button...');
      await toggleElement.click();
      console.log('[UnifiedHelper] Toggle clicked');
    } else {
      console.log('[UnifiedHelper] Not necessary to click, it is already selected');
    }

    const parentElement = await this.page.waitForSelector(`${parentSelector}`);

    // Wait for options to appear
    console.log('[UnifiedHelper] Waiting for option buttons to appear...');
    await this.page.waitForSelector(`${parentSelector} button[role="option"]`);
    console.log('[UnifiedHelper] Option buttons visible');
    
    // Find all option buttons using direct selector path
    console.log('[UnifiedHelper] Looking for option buttons...');

    const buttonsHandle = await parentElement?.evaluateHandle((parentElement, optionValue) => {
      const buttons = Array.from(parentElement.querySelectorAll("button") || []);
      return buttons.map(button => ({
        text: button.textContent,
        id: button.id,
      }));
    }, optionValue);

    const buttons = await buttonsHandle?.jsonValue() as Array<{
      text: string;
      id: string;
    }>;

    console.log('[UnifiedHelper] Found buttons:', buttons);
    console.log(`[UnifiedHelper] Found ${buttons.length} matching buttons`);

    if (buttons.length === 0) {
      console.error('[UnifiedHelper] No button found with text:', optionValue);
      throw new Error(`Could not find company option with text "${optionValue}"`);
    }
      
    console.log('[UnifiedHelper] Looking for button:', optionValue);
    const button = buttons.find(button => button.id === optionValue || button.text.split('(')[0].trim() === optionValue);

    if (!button) {
      console.error('[UnifiedHelper] No button found with id or text:', optionValue);
      throw new Error(`Could not find company option button for "${optionValue}"`);
    }

    const selectionElement = await this.page.waitForSelector(`button[id='${button.id}']`);

    if (selectionElement) {
      console.log('[UnifiedHelper] Clicking matching option button...');
      await selectionElement.click();
      await selectionElement.dispose();
      console.log('[UnifiedHelper] Company picker selection complete');
    } else {
      console.log('[UnifiedHelper] picker selection not found');
    }
    
    return true;
  }
}

/**
 * Legacy compatibility wrapper that maintains the old helper interface
 * while delegating to the new unified system.
 */
export class LegacyHelperWrapper {
  constructor(private unifiedHelper: UnifiedAutomationHelper) {}

  async click(elementId: string) {
    const result = await this.unifiedHelper.execute(elementId, 'click');
    if (!result.success) {
      throw new Error(result.error || 'Click action failed');
    }
    return true;
  }

  async type(elementId: string, text: string) {
    const result = await this.unifiedHelper.execute(elementId, 'type', { text });
    if (!result.success) {
      throw new Error(result.error || 'Type action failed');
    }
    return true;
  }

  async select(elementId: string, optionValue: string) {
    const result = await this.unifiedHelper.execute(elementId, 'select', { option: optionValue });
    if (!result.success) {
      throw new Error(result.error || 'Select action failed');
    }
    return true;
  }

  async wait_for_navigation() {
    const result = await this.unifiedHelper.wait('navigation');
    if (!result.success) {
      throw new Error(result.error || 'Navigation wait failed');
    }
    return true;
  }

  async navigate(url: string) {
    const result = await this.unifiedHelper.execute('', 'navigate', { url });
    if (!result.success) {
      throw new Error(result.error || 'Navigation failed');
    }
    return true;
  }
}