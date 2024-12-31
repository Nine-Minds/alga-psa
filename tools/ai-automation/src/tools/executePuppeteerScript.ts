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
    
    // Check if script is already an async function
    if (script.trim().startsWith('async')) {
      // Execute the function directly
      const fn = new Function('page', `return (${script})(page);`);
      return await fn(page);
    } else {
      // Wrap non-function scripts in an async function
      const fn = new Function('page', `return (async (page) => { ${script} })(page);`);
      return await fn(page);
    }
  }
};
