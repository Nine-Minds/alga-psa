import { describe, expect, it } from "vitest";
import {
  PRELAYOUT_TAG_CAP,
  computeVisibleTagCount,
  estimateOverflowPillWidth,
  estimateTagChipWidth,
  TAG_CHIP_GAP,
} from "./ticketRowTags";

describe("computeVisibleTagCount", () => {
  it("returns 0 for no tags", () => {
    expect(computeVisibleTagCount([], 300)).toBe(0);
  });

  it("falls back to a small cap before layout is measured", () => {
    expect(computeVisibleTagCount(["a", "b", "c", "d", "e"], 0)).toBe(PRELAYOUT_TAG_CAP);
    expect(computeVisibleTagCount(["a", "b"], 0)).toBe(2);
  });

  it("shows all tags when they fit", () => {
    const tags = ["vip", "billing"];
    const total =
      estimateTagChipWidth("vip") + estimateTagChipWidth("billing") + TAG_CHIP_GAP;
    expect(computeVisibleTagCount(tags, total)).toBe(2);
    expect(computeVisibleTagCount(tags, total + 100)).toBe(2);
  });

  it("caps with room reserved for the overflow pill when tight", () => {
    const tags = ["1111", "2222", "333", "988888", "areytwe", "asbrhaet", "new tag", "tag"];
    const width = 280;
    const shown = computeVisibleTagCount(tags, width);
    expect(shown).toBeGreaterThanOrEqual(1);
    expect(shown).toBeLessThan(tags.length);

    const shownWidth = tags
      .slice(0, shown)
      .reduce((sum, tag) => sum + estimateTagChipWidth(tag), 0);
    const needed =
      shownWidth + TAG_CHIP_GAP * shown + estimateOverflowPillWidth(tags.length - shown);
    expect(needed).toBeLessThanOrEqual(width);
  });

  it("shows more short tags than long ones in the same space", () => {
    const width = 300;
    const short = computeVisibleTagCount(["aa", "bb", "cc", "dd", "ee", "ff"], width);
    const long = computeVisibleTagCount(
      ["network-outage", "voip-degradation", "customer-escalation", "follow-up-call", "hardware", "warranty"],
      width,
    );
    expect(short).toBeGreaterThan(long);
  });

  it("always shows at least one tag even on very narrow rows", () => {
    expect(computeVisibleTagCount(["extremely-long-tag-name-here", "another"], 60)).toBe(1);
  });
});
