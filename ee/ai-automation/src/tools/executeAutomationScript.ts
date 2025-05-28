import { Tool } from './Tool.js';
import type { Page } from 'puppeteer';
import { puppeteerManager } from '../puppeteerManager.js';

interface ExecuteAutomationScriptArgs {
  script: string;
}

export const executeAutomationScript: Tool = {
  name: 'execute_automation_script',
  description: 'Execute a Puppeteer script in the browser context',
  
  async execute(page: Page, args: ExecuteAutomationScriptArgs): Promise<any> {
    if (!args.script) {
      throw new Error('Script is required');
    }

    try {
      return await puppeteerManager.execute_automation_script(args.script);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Error executing puppeteer script:', {
        error: errorMessage,
        script: args.script.slice(0, 100) + (args.script.length > 100 ? '...' : '')
      });
      return errorMessage;
    }
  }
};
