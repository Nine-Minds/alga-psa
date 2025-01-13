import type { Page } from 'puppeteer';

export class PuppeteerHelper {
  constructor(private page: Page) {}

  async fillRadixSelect(automationId: string, optionValue: string) {
    // Find the parent div by data-automation-id
    const parentSelector = `div[id="${automationId}"]`;
    console.log('[PuppeteerHelper] Waiting for parent element:', parentSelector);
    await this.page.waitForSelector(parentSelector);
    console.log('[PuppeteerHelper] Parent element found:', parentSelector);

    // Find and click the select element
    const selectSelector = `${parentSelector}`;
    console.log('[PuppeteerHelper] Select element selector:', selectSelector);
    
    // Get all options and find the index of our target value or text
    const options = await this.page.evaluate((selector, targetValue) => {
      const select = document.querySelector(selector) as HTMLSelectElement;
      return Array.from(select.options).findIndex(option => 
        option.value === targetValue || option.text === targetValue
      );
    }, `${selectSelector} select`, optionValue);
    
    if (options === -1) {
      throw new Error(`Option "${optionValue}" not found in select options (checked both value and text)`);
    }
    const targetIndex = options;

    // Click the select element to open it
    await this.page.click(selectSelector);
    
    // Press down arrow key the correct number of times to reach our option
    for (let i = 0; i < targetIndex; i++) {
      await this.page.keyboard.press('ArrowDown');
      // Add a small delay to ensure the UI keeps up
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    // Press Enter to select the option
    await this.page.keyboard.press('Enter');
    
    return true;
  }
}
