import { Page, PuppeteerLifeCycleEvent } from 'puppeteer';

const debug = (message: string, ...args: any[]) => {
  console.log(`[Puppeteer Script] ${message}`, ...args);
};

interface EvaluateOptions {
  waitUntil?: PuppeteerLifeCycleEvent | PuppeteerLifeCycleEvent[];
  waitForNavigation?: boolean;
  retries?: number;
  retryDelay?: number;
}

const DEFAULT_OPTIONS: EvaluateOptions = {
  waitForNavigation: false,
  retries: 3,
  retryDelay: 1000,
  waitUntil: 'networkidle0'
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Ensures any pending navigations are completed before proceeding
 */
const ensureNavigationComplete = async (page: Page, waitUntil: PuppeteerLifeCycleEvent | PuppeteerLifeCycleEvent[]) => {
  debug('Checking for pending navigation...');
  try {
    // This will resolve immediately if no navigation is pending
    await Promise.race([
      page.waitForNavigation({ waitUntil }).then(() => {
        debug('Navigation completed');
        return true;
      }),
      // Add a small timeout to avoid waiting indefinitely if there's no navigation
      new Promise(resolve => setTimeout(() => {
        debug('No navigation detected');
        resolve(false);
      }, 100))
    ]);
  } catch (error) {
    debug('Navigation check error (ignored):', error);
  }
};

export const evaluate = async (
  page: Page, 
  code: string, 
  options: EvaluateOptions = DEFAULT_OPTIONS
): Promise<any> => {
  const { waitForNavigation, retries, retryDelay } = { ...DEFAULT_OPTIONS, ...options };
  
  let lastError: Error | null = null;
  
  debug('Starting script evaluation with options:', options);
  
  for (let attempt = 0; attempt < (retries ?? 1); attempt++) {
    if (attempt > 0) {
      debug(`Retry attempt ${attempt + 1}/${retries}`);
    }
    try {
      // Wait for any pending navigations to complete
      await ensureNavigationComplete(page, options.waitUntil || 'networkidle0');
      
      // Ensure page is ready
      debug('Waiting for page to be ready...');
      await page.waitForFunction(() => document.readyState === 'complete');
      debug('Page ready state confirmed');
      
      if (waitForNavigation) {
        debug('Executing with navigation wait...');
        const [result] = await Promise.all([
          page.evaluate(code),
          page.waitForNavigation({ waitUntil: 'networkidle0' })
            .catch(error => {
              debug('Navigation error (handled):', error);
            })
        ]);
        debug('Execution with navigation completed');
        return result;
      } else {
        debug('Executing without navigation wait...');
        const result = await page.evaluate(code);
        debug('Execution completed');
        return result;
      }
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      debug('Execution error:', lastError.message);
      
      // Check if this was a context destruction error
      if (lastError.message.includes('Execution context was destroyed')) {
        debug('Context destruction detected');
        // Wait before retrying
        if (attempt < (retries ?? 1) - 1) {
          debug(`Waiting ${retryDelay}ms before retry...`);
          await sleep(retryDelay ?? 1000);
          continue;
        }
      } else {
        debug('Non-retryable error detected');
        // For other errors, throw immediately
        break;
      }
    }
  }
  
  const errorMessage = `Script evaluation failed after ${retries} attempts: ${lastError}`;
  debug(errorMessage);
  throw new Error(errorMessage);
};
