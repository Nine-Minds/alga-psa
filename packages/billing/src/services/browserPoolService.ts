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

    return new Promise((resolve) => {
      const interval = setInterval(async () => {
        if (this.browserPool.length > 0) {
          const browser = this.browserPool.pop();
          if (browser && browser.isConnected()) {
            clearInterval(interval);
            this.activeBrowsers++;
            resolve(browser!);
          }
        } else if (this.activeBrowsers < this.maxBrowsers) {
            const browser = await puppeteer.launch({
              headless: true,
              executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
              args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            });
            this.activeBrowsers++;
            clearInterval(interval);
            resolve(browser);
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