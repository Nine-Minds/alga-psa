/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copyTextToClipboard } from './clipboard';

const writeText = vi.fn(async (_text: string) => undefined);

const setClipboard = (value: unknown) =>
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });

describe('copyTextToClipboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setClipboard({ writeText });
    document.execCommand = vi.fn(() => true);
  });

  it('uses the Clipboard API when it is available', async () => {
    await expect(copyTextToClipboard('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it('falls back to execCommand on insecure origins without the Clipboard API', async () => {
    setClipboard(undefined);
    let copiedValue: string | undefined;
    vi.mocked(document.execCommand).mockImplementation(() => {
      copiedValue = document.querySelector('textarea')?.value;
      return true;
    });

    await expect(copyTextToClipboard('hello')).resolves.toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(copiedValue).toBe('hello');
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });

  it('falls back to execCommand when the Clipboard API rejects', async () => {
    writeText.mockRejectedValueOnce(new Error('Clipboard denied'));

    await expect(copyTextToClipboard('hello')).resolves.toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('reports failure when execCommand refuses to copy', async () => {
    setClipboard(undefined);
    vi.mocked(document.execCommand).mockReturnValue(false);

    await expect(copyTextToClipboard('hello')).resolves.toBe(false);
  });

  it('reports failure and cleans up when execCommand throws', async () => {
    setClipboard(undefined);
    vi.mocked(document.execCommand).mockImplementation(() => {
      throw new Error('Copy command failed');
    });

    await expect(copyTextToClipboard('hello')).resolves.toBe(false);
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });

  it('restores focus to the element that had it before copying', async () => {
    setClipboard(undefined);
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();

    await copyTextToClipboard('hello');

    expect(document.activeElement).toBe(button);
    button.remove();
  });
});
