import puppeteer, { Browser } from 'puppeteer';

const MAX_BROWSERS = 5;

export class BrowserPoolService {
  private browserPool: Browser[] = [];
  private activeBrowsers = 0;

  constructor(private maxBrowsers: number = MAX_BROWSERS) {}

  async getBrowser(): Promise<Browser> {
    if (this.browserPool.length > 0) {
      const browser = this.browserPool.pop();
      if (browser && browser.isConnected()) {
        this.activeBrowsers++;
        return browser!;
      }
    }

    if (this.activeBrowsers < this.maxBrowsers) {
      const browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
      this.activeBrowsers++;
      return browser;
    }

    // LEVERAGE: friction browser-pool-duplication — server/src/services/browser-pool.service.ts
    // is a near-identical second copy of this class, so every fix here has to be
    // made twice. One pool behind one import would retire the divergence.
    return new Promise((resolve, reject) => {
      const interval = setInterval(async () => {
        if (this.browserPool.length > 0) {
          const browser = this.browserPool.pop();
          if (browser && browser.isConnected()) {
            clearInterval(interval);
            this.activeBrowsers++;
            resolve(browser!);
          }
        } else if (this.activeBrowsers < this.maxBrowsers) {
          // Stop the interval before awaiting: otherwise a slow launch lets the
          // next tick start a second one and blow past maxBrowsers.
          clearInterval(interval);
          try {
            const browser = await puppeteer.launch({
              headless: true,
              executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
              args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            });
            this.activeBrowsers++;
            resolve(browser);
          } catch (error) {
            // Without this the launch failure became an unhandled rejection and
            // the caller waited forever — which is how a missing chromium binary
            // presented as a hung PDF download rather than an error.
            reject(error);
          }
        }
      }, 100);
    });
  }

  async releaseBrowser(browser: Browser | null): Promise<void> {
    if (browser) {
      if (this.browserPool.length < this.maxBrowsers && browser.isConnected()) {
        this.browserPool.push(browser);
      } else {
        await browser.close();
      }
      this.activeBrowsers--;
    }
  }

  async cleanup(): Promise<void> {
    await Promise.all(this.browserPool.map(browser => browser.close()));
    this.browserPool = [];
    this.activeBrowsers = 0;
  }
}

export const browserPoolService = new BrowserPoolService();