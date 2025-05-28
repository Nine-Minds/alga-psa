import type { Page } from 'puppeteer';

export interface Tool {
  name: string;
  description: string;
  execute(page: Page, args: any): Promise<any>;
}
