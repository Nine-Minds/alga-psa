import type { Page } from 'puppeteer';

export class PuppeteerHelper {
  constructor(private page: Page) {}

  async type(elementId: string, text: string) {
    // Try data-automation-id first, then fallback to id
    let element;
    try {
      console.log(`[PuppeteerHelper] Trying data-automation-id="${elementId}" for typing`);
      element = await this.page.waitForSelector(`[data-automation-id="${elementId}"]`, { timeout: 5000 });
    } catch (error) {
      console.log(`[PuppeteerHelper] data-automation-id not found, trying id="${elementId}" for typing`);
      try {
        element = await this.page.waitForSelector(`[id="${elementId}"]`, { timeout: 5000 });
      } catch (fallbackError) {
        throw new Error(`Could not find element with data-automation-id="${elementId}" or id="${elementId}" for typing`);
      }
    }
    
    if (!element) {
      throw new Error(`Could not find element with id: ${elementId}`);
    }

    console.log('[PuppeteerHelper] Typing into element:', elementId);
    
    // Improved focus and typing strategy to prevent focus issues
    try {
      // 1. Click the element to ensure it receives focus
      await element.click();
      
      // 2. Small delay to allow focus to settle
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 3. Clear existing content using multiple approaches for reliability
      try {
        // Method 1: Triple-click to select all content in the field
        await element.click({ clickCount: 3 });
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Method 2: Use Puppeteer's built-in method to clear the field
        await element.evaluate((el: any) => {
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
      } catch (clearError) {
        console.warn(`[PuppeteerHelper] Could not clear field ${elementId}, proceeding with typing:`, clearError);
      }
      
      // 4. Small delay before typing
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // 5. Type the new text
      await element.type(text);
      
      console.log(`[PuppeteerHelper] Successfully typed "${text}" into element: ${elementId}`);
    } catch (typingError: any) {
      console.error(`[PuppeteerHelper] Error during typing into ${elementId}:`, typingError);
      throw new Error(`Failed to type into element ${elementId}: ${typingError.message}`);
    }
    
    return true;
  }

  async click(elementId: string) {
    if (elementId.endsWith('-toggle')) {
      throw new Error('Do not click on pickers! Use select instead.');
    }
    if (elementId.endsWith('-picker')) {
      throw new Error('Do not click on pickers! Use select instead.');
    }

    // Try data-automation-id first, then fallback to id
    let element;
    try {
      console.log(`[PuppeteerHelper] Trying data-automation-id="${elementId}"`);
      element = await this.page.waitForSelector(`[data-automation-id="${elementId}"]`, { timeout: 5000 });
    } catch (error) {
      console.log(`[PuppeteerHelper] data-automation-id not found, trying id="${elementId}"`);
      try {
        element = await this.page.waitForSelector(`[id="${elementId}"]`, { timeout: 5000 });
      } catch (fallbackError) {
        throw new Error(`Could not find element with data-automation-id="${elementId}" or id="${elementId}"`);
      }
    }
    
    if (!element) {
      throw new Error(`Could not find element with id: ${elementId}`);
    }

    console.log('[PuppeteerHelper] Clicking element:', elementId);
    await element.click();
    return true;
  }

  async wait_for_navigation() {
    console.log('[PuppeteerHelper] Waiting for navigation to complete');
    await this.page.waitForNetworkIdle({ idleTime: 500 })
    return true;
  }

  private async selectStandard(parentSelector: string, optionValue: string) {
    const selectSelector = `${parentSelector} select`;
    const options = await this.page.evaluate((selector, targetValue) => {
      const select = document.querySelector(selector) as HTMLSelectElement;
      Array.from(select.options).forEach(option => {
        console.log('[PuppeteerHelper::selectStandard] Option:', option.value, option.text);
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

  private async selectPicker(parentSelector: string, optionValue: string) {
    console.log('[PuppeteerHelper] Starting company picker selection', {
      parentSelector,
      optionValue
    });

    let toggleElement;
    let hasDivSibling;

    if (parentSelector.endsWith('-toggle')) {
      console.log('[PuppeteerHelper] Parent selector ends with -toggle, finding parent element...');
      toggleElement = await this.page.waitForSelector(parentSelector);
      if (!toggleElement) {
        throw new Error(`Could not find toggle element with selector: ${parentSelector}`);
      }

      const parentId = await toggleElement.evaluate(el => el.parentElement?.id);
      if (!parentId) {
        throw new Error('Could not find parent element ID');
      }

      parentSelector = `#${parentId}`;
      console.log('[PuppeteerHelper] Updated parent selector:', parentSelector);
    } else {
      // Generate toggle ID
      const toggleId = parentSelector.replaceAll(/company-picker-company-picker/g, 'company-picker-toggle');
      console.log('[PuppeteerHelper] Generated toggle ID:', toggleId);

      // Find toggle element
      console.log('[PuppeteerHelper] Waiting for toggle element...');
        toggleElement = await this.page.waitForSelector(toggleId);
      if (!toggleElement) {
        console.error('[PuppeteerHelper] Toggle element not found');
        throw new Error(`Could not find toggle element with selector: ${toggleId}`);
      }
    }

    console.log('[PuppeteerHelper] Found toggle element');

    // Check for adjacent div sibling
    hasDivSibling = await toggleElement.evaluate(el => {
        const nextSibling = el.nextElementSibling;
        return nextSibling && nextSibling.tagName.toLowerCase() === 'div';
      });

    console.log('[PuppeteerHelper] Toggle element has adjacent div sibling:', hasDivSibling);

    // Click toggle
    if (!hasDivSibling) {
      console.log('[PuppeteerHelper] Clicking toggle button...');
      await toggleElement.click();
      console.log('[PuppeteerHelper] Toggle clicked');
    } else {
      console.log('[PuppeteerHelper] Not necessary to click, it is already selected');
    }

    const parentElement = await this.page.waitForSelector(`${parentSelector}`);

    // Wait for options to appear
    console.log('[PuppeteerHelper] Waiting for option buttons to appear...');
    await this.page.waitForSelector(`${parentSelector} button[role="option"]`);
    console.log('[PuppeteerHelper] Option buttons visible');
    
    // Find all option buttons using direct selector path
    console.log('[PuppeteerHelper] Looking for option buttons...');

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

    console.log('[PuppeteerHelper] Found buttons:', buttons);
    console.log(`[PuppeteerHelper] Found ${buttons.length} matching buttons`);

    if (buttons.length === 0) {
      console.error('[PuppeteerHelper] No button found with text:', optionValue);
      throw new Error(`Could not find company option with text "${optionValue}"`);
    }
      
    console.log('[PuppeteerHelper] Looking for button:', optionValue);
    const button = buttons.find(button => button.id === optionValue || button.text.split('(')[0].trim() === optionValue);

    if (!button) {
      console.error('[PuppeteerHelper] No button found with id or text:', optionValue);
      throw new Error(`Could not find company option button for "${optionValue}"`);
    }

    const selectionElement = await this.page.waitForSelector(`button[id='${button.id}']`);

    if (selectionElement) {
      // Click the matching option
      console.log('[PuppeteerHelper] Clicking matching option button...');
      await selectionElement.click();

      // Cleanup
      console.log('[PuppeteerHelper] Cleaning up element handle...');
      await selectionElement.dispose();
      console.log('[PuppeteerHelper] Company picker selection complete');
    } else {
        console.log('[PuppeteerHelper] picker selection not found');
    }
    
    return true;
  }

  async select(elementId: string, optionValue: string) {
    const parentSelector = `[data-automation-id="${elementId}"],[id="${elementId}"]`;
    console.log('[PuppeteerHelper] Waiting for parent element', parentSelector);
    await this.page.waitForSelector(parentSelector);
    
    const automationType = await this.page.evaluate((selector) => {
      const element = document.querySelector(selector);
      return element?.getAttribute('data-automation-type') || 'standard';
    }, parentSelector);

    console.log(`[PuppeteerHelper] Using ${automationType} select handler`);

    switch (automationType) {
      case 'picker':
        await this.selectPicker(parentSelector, optionValue);
        break;
      case 'select':
        await this.selectStandard(parentSelector, optionValue);
        break;
      case 'custom':
        throw new Error(`only click is supported for automation type: custom`);
      default:
        throw new Error(`Unsupported automation type: ${automationType}`);
    }

    await this.page.waitForNetworkIdle({ idleTime: 500 });
    return true;
  }

  async navigate(url: string) {
    console.log('[PuppeteerHelper] Navigating to:', url);
    await this.page.goto(url);
    await this.wait_for_navigation();
    return true;
  }
}
