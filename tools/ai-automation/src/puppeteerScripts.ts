import { Page } from 'puppeteer';

export const evaluate = async (page: Page, code: string): Promise<any> => {
  try {
    return await page.evaluate(code);
  } catch (error) {
    throw new Error(`Script evaluation failed: ${error}`);
  }
};
