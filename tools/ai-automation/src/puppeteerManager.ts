import puppeteer from 'puppeteer';
import type { Browser, Page } from 'puppeteer';
import { browserSessionManager } from './browserSessionManager.js';

class PuppeteerManager {
  private static instance: PuppeteerManager;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private isInitializing = false;
  private sessionId: string = 'default';

  private constructor() {}

  public static getInstance(): PuppeteerManager {
    if (!PuppeteerManager.instance) {
      PuppeteerManager.instance = new PuppeteerManager();
    }
    return PuppeteerManager.instance;
  }

  public async init(options?: { headless: boolean, args: string[] }, retries = 5) {
    if (this.browser || this.isInitializing) {
      console.log('Puppeteer already initialized or initializing');
      return;
    }

    console.log('Starting Puppeteer initialization using BrowserSessionManager...');
    this.isInitializing = true;

    try {
      const mode = options?.headless === false ? 'headed' : 'headless';
      const session = await browserSessionManager.createSession(this.sessionId, mode);
      
      this.browser = session.browser;
      this.page = session.page;
      
      console.log(`Puppeteer initialization completed successfully in ${mode} mode`);
    } catch (error) {
      console.error('Puppeteer initialization failed:', error);
      this.browser = null;
      this.page = null;
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  public getPage(): Page {
    if (!this.page) {
      throw new Error('Puppeteer page not initialized yet');
    }
    return this.page;
  }

  public async execute_automation_script(script: string): Promise<any> {
    console.log('Executing automation script:', script);
    
    if (!this.page) {
      throw new Error('Puppeteer page not initialized yet');
    }
    
    try {
      // Dynamically import helper modules with cache busting
      let PuppeteerHelper, UnifiedAutomationHelper, LegacyHelperWrapper;
      try {
        const timestamp = Date.now().toString();
        
        // Import PuppeteerHelper (for fallback)
        const helperUrl = new URL('./puppeteerHelper.ts', import.meta.url);
        helperUrl.searchParams.set('t', timestamp);
        console.log('[Module Loading] Importing PuppeteerHelper from:', helperUrl.href);
        const puppeteerModule = await import(helperUrl.href);
        PuppeteerHelper = puppeteerModule.PuppeteerHelper;
        
        // Import UnifiedAutomationHelper
        const unifiedUrl = new URL('./unifiedAutomationHelper.ts', import.meta.url);
        unifiedUrl.searchParams.set('t', timestamp);
        console.log('[Module Loading] Importing UnifiedAutomationHelper from:', unifiedUrl.href);
        const unifiedModule = await import(unifiedUrl.href);
        UnifiedAutomationHelper = unifiedModule.UnifiedAutomationHelper;
        LegacyHelperWrapper = unifiedModule.LegacyHelperWrapper;
        
        if (!PuppeteerHelper) {
          throw new Error('PuppeteerHelper not found in module');
        }
        if (!UnifiedAutomationHelper) {
          throw new Error('UnifiedAutomationHelper not found in module');
        }
      } catch (importError) {
        console.error('[Module Loading] Failed to import helper modules:', importError);
        throw new Error(`Failed to load helper modules: ${importError instanceof Error ? importError.message : String(importError)}`);
      }

      // Create unified helper system
      console.log('[Module Loading] Creating unified helper system...');
      const unifiedHelper = new UnifiedAutomationHelper(this.page);
      const legacyHelper = new LegacyHelperWrapper(unifiedHelper);
      
      // Create combined helper object with both new and legacy methods
      const helper = {
        // New unified methods
        execute: unifiedHelper.execute.bind(unifiedHelper),
        query: unifiedHelper.query.bind(unifiedHelper),
        wait: unifiedHelper.wait.bind(unifiedHelper),
        
        // Legacy methods for backward compatibility
        click: legacyHelper.click.bind(legacyHelper),
        type: legacyHelper.type.bind(legacyHelper),
        select: legacyHelper.select.bind(legacyHelper),
        wait_for_navigation: legacyHelper.wait_for_navigation.bind(legacyHelper),
        navigate: legacyHelper.navigate.bind(legacyHelper)
      };
      
      console.log('[Module Loading] Helper system created with methods:', Object.keys(helper));
      
      // Execute the script with only helper available
      const scriptFn = new Function('helper', `
        return (async () => {
          try {
            return ${script}
          } catch (error) {
            console.error('Error in automation script execution:', error);
            return { error: error.message };
          }
        })();
      `);
      
      const result = await Promise.resolve(scriptFn(helper));
      console.log('Function execution result:', result);
      
      return result;
    } catch (error: unknown) {
      console.error('Error executing Puppeteer script:', error);
      const message = error instanceof Error ? error.message : 'Unknown error occurred';
      return message;
    }
  }

  public async popOut(): Promise<{ sessionId: string; mode: string; wsEndpoint?: string }> {
    console.log('Popping out browser to headed mode...');
    
    try {
      const session = await browserSessionManager.popOutSession(this.sessionId);
      
      // Update internal references
      this.browser = session.browser;
      this.page = session.page;
      this.sessionId = session.id;
      
      console.log(`Browser popped out successfully to session ${session.id}`);
      return {
        sessionId: session.id,
        mode: session.mode,
        wsEndpoint: session.wsEndpoint
      };
    } catch (error) {
      console.error('Error popping out browser:', error);
      throw error;
    }
  }

  public async popIn(): Promise<{ sessionId: string; mode: string }> {
    console.log('Popping in browser to headless mode...');
    
    try {
      const session = await browserSessionManager.popInSession(this.sessionId);
      
      // Update internal references
      this.browser = session.browser;
      this.page = session.page;
      this.sessionId = session.id;
      
      console.log(`Browser popped in successfully to session ${session.id}`);
      return {
        sessionId: session.id,
        mode: session.mode
      };
    } catch (error) {
      console.error('Error popping in browser:', error);
      throw error;
    }
  }

  public getSessionStatus(): {
    currentSessionId: string;
    activeSessionId: string | null;
    sessionCount: number;
    sessions: Array<{ id: string; mode: 'headless' | 'headed'; url: string; wsEndpoint?: string }>;
  } {
    const status = browserSessionManager.getSessionStatus();
    return {
      currentSessionId: this.sessionId,
      ...status
    };
  }

  public async close() {
    if (this.sessionId) {
      try {
        await browserSessionManager.closeSession(this.sessionId);
      } catch (error) {
        console.error('Error closing browser session:', error);
      } finally {
        this.browser = null;
        this.page = null;
        this.sessionId = 'default';
      }
    }
  }
}

export const puppeteerManager = PuppeteerManager.getInstance();
