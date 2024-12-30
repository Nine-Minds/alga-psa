import { Page } from 'puppeteer';
import { Tool } from './Tool';

export const executeScript: Tool = {
  name: 'execute_script',
  description: 'Execute a puppeteer script',
  async execute(page: Page, args: { script: string }) {
    if (!args.script) {
      throw new Error('Script argument is required');
    }
    const result = await page.evaluate(args.script);
    return { result };
  },
};
