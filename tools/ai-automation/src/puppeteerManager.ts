import puppeteer, { Browser, Page } from 'puppeteer';

class PuppeteerManager {
  private browser: Browser | null = null;
  private page: Page | null = null;

  public async init() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox']
      });
      this.page = await this.browser.newPage();
      
      if (this.page) {
        this.page.on('console', (msg) => {
          console.log(`[PAGE CONSOLE] ${msg.type()}: ${msg.text()}`);
        });
        this.page.on('pageerror', (err) => {
          console.error(`[PAGE ERROR]`, err);
        });
      }
    }
  }

  public getPage(): Page {
    if (!this.page) {
      throw new Error('Puppeteer page not initialized yet');
    }
    return this.page;
  }

  public async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}

export const puppeteerManager = new PuppeteerManager();
