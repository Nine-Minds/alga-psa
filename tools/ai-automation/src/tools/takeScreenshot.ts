import { Page } from 'puppeteer';
import { Tool } from './Tool';

export const takeScreenshot: Tool = {
  name: 'take_screenshot',
  description: 'Take a screenshot of the current page',
  async execute(page: Page, args: { fullPage?: boolean }) {
    const screenshot = await page.screenshot({
      encoding: 'base64',
      fullPage: args.fullPage || false,
    });
    return { screenshot };
  },
};
