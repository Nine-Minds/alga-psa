/**
 * The screen-only "Page n of N" caption drawn under each sheet of a paginated preview.
 *
 * The caption is framing the preview invents (see previewSeparation.test.ts — none of it may reach
 * paper), so it is read by whoever has the preview open rather than by the document's recipient. It
 * therefore speaks the READER's language: a Swedish invoice opened by an English-speaking author is
 * captioned in English, the same as every other control around it. Only a caller that already knows
 * the reader's locale — or a test pinning one — passes `captionLocale`.
 */
export const buildPreviewPageCaptions = async (
  pageCount: number,
  captionLocale?: string,
): Promise<string[]> => {
  let translate: (page: number, total: number) => string = (page, total) => `Page ${page} of ${total}`;
  try {
    const [{ getServerLocale, getServerTranslation }, { normalizeLocale }] = await Promise.all([
      import('@alga-psa/ui/lib/i18n/serverOnly'),
      import('@alga-psa/core/i18n/config'),
    ]);
    const locale = normalizeLocale(captionLocale) ?? (await getServerLocale());
    const { t } = await getServerTranslation(locale ?? undefined, 'msp/invoicing');
    translate = (page, total) =>
      String(t('designer.workspace.preview.pageCaption', { defaultValue: 'Page {{page}} of {{total}}', page, total }));
  } catch {
    // An unlocalized caption still tells the reader which sheet they are reading.
  }
  return Array.from({ length: pageCount }, (_, index) => translate(index + 1, pageCount));
};
