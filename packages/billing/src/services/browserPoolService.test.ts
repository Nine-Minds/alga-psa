import { beforeEach, describe, expect, it, vi } from 'vitest';

const { launchMock } = vi.hoisted(() => ({ launchMock: vi.fn() }));

vi.mock('puppeteer', () => ({
  default: { launch: launchMock },
}));

import { BrowserPoolService } from './browserPoolService';

const stubBrowser = (overrides: Record<string, unknown> = {}) => ({
  isConnected: () => true,
  close: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const slotsInUse = (pool: BrowserPoolService) => (pool as any).activeBrowsers;

describe('BrowserPoolService slot accounting', () => {
  beforeEach(() => {
    launchMock.mockReset();
  });

  it('frees the slot when close() rejects', async () => {
    const pool = new BrowserPoolService(1);
    const doomed = stubBrowser({
      isConnected: () => false,
      close: vi.fn().mockRejectedValue(new Error('Target closed')),
    });
    const replacement = stubBrowser();
    launchMock.mockResolvedValueOnce(doomed).mockResolvedValueOnce(replacement);

    const borrowed = await pool.getBrowser();
    expect(borrowed).toBe(doomed);
    expect(slotsInUse(pool)).toBe(1);

    await expect(pool.releaseBrowser(borrowed)).rejects.toThrow('Target closed');

    // The decrement used to sit after the awaited close(), so a rejection
    // skipped it and burned the slot for the lifetime of the process.
    expect(slotsInUse(pool)).toBe(0);
    await expect(pool.getBrowser()).resolves.toBe(replacement);
  });

  it('surfaces the close() failure to the caller', async () => {
    const pool = new BrowserPoolService(1);
    const browser = stubBrowser({
      isConnected: () => false,
      close: vi.fn().mockRejectedValue(new Error('Protocol error')),
    });
    launchMock.mockResolvedValueOnce(browser);

    await expect(pool.releaseBrowser(await pool.getBrowser())).rejects.toThrow('Protocol error');
  });

  it('frees the slot when close() succeeds', async () => {
    const pool = new BrowserPoolService(1);
    const browser = stubBrowser({ isConnected: () => false });
    launchMock.mockResolvedValueOnce(browser);

    await pool.releaseBrowser(await pool.getBrowser());

    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(slotsInUse(pool)).toBe(0);
  });

  it('returns a connected browser to the pool for reuse', async () => {
    const pool = new BrowserPoolService(1);
    const browser = stubBrowser();
    launchMock.mockResolvedValueOnce(browser);

    await pool.releaseBrowser(await pool.getBrowser());
    expect(slotsInUse(pool)).toBe(0);
    expect(browser.close).not.toHaveBeenCalled();

    await expect(pool.getBrowser()).resolves.toBe(browser);
    expect(launchMock).toHaveBeenCalledTimes(1);
  });

  it('ignores a null release instead of driving the count negative', async () => {
    const pool = new BrowserPoolService(1);

    await pool.releaseBrowser(null);

    expect(slotsInUse(pool)).toBe(0);
  });
});
