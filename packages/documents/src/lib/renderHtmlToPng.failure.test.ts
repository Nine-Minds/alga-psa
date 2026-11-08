import { beforeEach, describe, expect, it, vi } from 'vitest';

const { close, setContent } = vi.hoisted(() => ({
  close: vi.fn(),
  setContent: vi.fn(),
}));

vi.mock('puppeteer', () => ({
  default: {
    launch: vi.fn(async () => ({
      newPage: vi.fn(async () => ({
        setViewport: vi.fn(),
        setJavaScriptEnabled: vi.fn(),
        setRequestInterception: vi.fn(),
        on: vi.fn(),
        setContent,
        screenshot: vi.fn(),
      })),
      close,
      process: vi.fn(() => ({ kill: vi.fn() })),
    })),
  },
}));

import { renderHtmlToPng } from './renderHtmlToPng';

const PNG_MAGIC = Buffer.from('89504e470d0a1a0a', 'hex');

describe('renderHtmlToPng failure cleanup', () => {
  beforeEach(() => {
    close.mockReset().mockResolvedValue(undefined);
    setContent.mockReset().mockRejectedValue(new Error('navigation timeout'));
  });

  it('returns a safe placeholder and closes Chromium after a navigation failure', async () => {
    const result = await renderHtmlToPng({ kind: 'text', text: 'preview' });

    expect(result.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(setContent).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      waitUntil: 'domcontentloaded',
      timeout: 5000,
    }));
  });
});
