// Estimates how many tag chips fit on a single line of a ticket row.
// The numbers mirror the chip styling in TicketsListScreen: caption text
// (~12pt semibold), horizontal padding 8 each side, 1px borders, 4px gaps,
// and a 160pt cap on the label text.

export const TAG_CHAR_WIDTH = 7.2;
export const TAG_CHIP_EXTRA_WIDTH = 18;
export const TAG_CHIP_MAX_TEXT_WIDTH = 160;
export const TAG_CHIP_GAP = 4;
export const PRELAYOUT_TAG_CAP = 3;

export function estimateTagChipWidth(text: string): number {
  return Math.min(text.length * TAG_CHAR_WIDTH, TAG_CHIP_MAX_TEXT_WIDTH) + TAG_CHIP_EXTRA_WIDTH;
}

export function estimateOverflowPillWidth(hiddenCount: number): number {
  return `+${hiddenCount}`.length * TAG_CHAR_WIDTH + TAG_CHIP_EXTRA_WIDTH;
}

/**
 * Greedy single-line fit: show every tag when they all fit, otherwise the
 * longest prefix that fits alongside a "+N" overflow pill (always at least
 * one tag). Before the container has been measured (width 0), fall back to
 * a small fixed cap so the first paint is sane.
 */
export function computeVisibleTagCount(tagTexts: string[], containerWidth: number): number {
  const count = tagTexts.length;
  if (count === 0) return 0;
  if (containerWidth <= 0) return Math.min(count, PRELAYOUT_TAG_CAP);

  const widths = tagTexts.map(estimateTagChipWidth);
  const allWidth = widths.reduce((sum, w) => sum + w, 0) + TAG_CHIP_GAP * (count - 1);
  if (allWidth <= containerWidth) return count;

  for (let shown = count - 1; shown >= 1; shown--) {
    const shownWidth = widths.slice(0, shown).reduce((sum, w) => sum + w, 0);
    const needed = shownWidth + TAG_CHIP_GAP * shown + estimateOverflowPillWidth(count - shown);
    if (needed <= containerWidth) return shown;
  }
  return 1;
}
