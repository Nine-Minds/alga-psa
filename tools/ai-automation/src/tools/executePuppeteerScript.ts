import { Tool } from './Tool';
import { Page } from 'puppeteer';

interface ExecutePuppeteerScriptArgs {
  script: string;
}

export const executePuppeteerScript: Tool = {
  name: 'execute_puppeteer_script',
  description: 'Execute a Puppeteer script in the browser context',
  
  async execute(page: Page, args: ExecutePuppeteerScriptArgs): Promise<any> {
    if (!args.script) {
      throw new Error('Script is required');
    }

    const script = args.script;
    
    try {
      // Create a closure with page in scope and execute the script
      const fn = new Function('page', `
        const scriptFn = ${script}
        return scriptFn;
      `);
      return await fn(page);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes('Execution context was destroyed')) {
        return {
          success: true,
          message: 'Puppeteer script execution completed, with a navigation to a new page.'
        }
      }

      console.error('Error executing puppeteer script:', {
        error: errorMessage,
        script: script.slice(0, 100) + (script.length > 100 ? '...' : '')
      });
      throw error;
    }
  }
};