/**
 * The preview's page captions are read by whoever has the preview open, not by the document's
 * recipient: an English-speaking author reading a Swedish invoice was captioned "Sida 1 av 3"
 * under sheets surrounded by an English screen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const serverLocale = vi.fn(async () => 'en');
const serverTranslation = vi.fn(async (locale?: string) => ({
  t: (_key: string, options: { page: number; total: number }) =>
    `[${locale ?? 'none'}] ${options.page}/${options.total}`,
}));

vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  getServerLocale: (...args: unknown[]) => serverLocale(...(args as [])),
  getServerTranslation: (locale?: string) => serverTranslation(locale),
}));

import { buildPreviewPageCaptions } from './previewPageCaption';

describe('preview page captions', () => {
  beforeEach(() => {
    serverLocale.mockClear();
    serverTranslation.mockClear();
    serverLocale.mockResolvedValue('en');
  });

  it('speaks the reader’s language when no caption locale is given', async () => {
    serverLocale.mockResolvedValue('en');

    expect(await buildPreviewPageCaptions(3)).toEqual(['[en] 1/3', '[en] 2/3', '[en] 3/3']);
    expect(serverLocale).toHaveBeenCalled();
  });

  it('follows the reader even when the document is drawn in another language', async () => {
    serverLocale.mockResolvedValue('en');

    // The caller renders a Swedish document; nothing about that reaches the caption.
    const captions = await buildPreviewPageCaptions(2);

    expect(captions).toEqual(['[en] 1/2', '[en] 2/2']);
    expect(serverTranslation).toHaveBeenCalledWith('en');
  });

  it('uses a stated caption locale without asking for the reader’s', async () => {
    expect(await buildPreviewPageCaptions(1, 'sv')).toEqual(['[sv] 1/1']);
    expect(serverLocale).not.toHaveBeenCalled();
  });

  it('still numbers the sheets when the locale chain is unavailable', async () => {
    serverLocale.mockRejectedValue(new Error('no request scope'));

    expect(await buildPreviewPageCaptions(2)).toEqual(['Page 1 of 2', 'Page 2 of 2']);
  });
});
