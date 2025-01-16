import type { Page } from 'puppeteer';

export class PuppeteerHelper {
  constructor(private page: Page) {}

  async type(elementId: string, text: string) {
    // Try data-automation-id first, then fallback to id
    const element = await this.page.waitForSelector(`[data-automation-id="${elementId}"]`) || 
                   await this.page.waitForSelector(`[id="${elementId}"]`);
    
    if (!element) {
      throw new Error(`Could not find element with id: ${elementId}`);
    }

    console.log('[PuppeteerHelper] Typing into element:', elementId);
    await element.type(text);
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
    const element = await this.page.waitForSelector(`[data-automation-id="${elementId}"]`) ||
                   await this.page.waitForSelector(`[id="${elementId}"]`);
    
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
