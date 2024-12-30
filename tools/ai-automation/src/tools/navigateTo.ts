import { Page } from 'puppeteer';
import { Tool } from './Tool';

export const navigateTo: Tool = {
  name: 'navigate_to',
  description: 'Navigate to a specified URL',
  async execute(page: Page, args: { url: string }) {
    if (!args.url) {
      throw new Error('URL argument is required');
    }
    await page.goto(args.url);
    return { success: true, url: args.url };
  },
};
