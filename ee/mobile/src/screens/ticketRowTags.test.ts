import { describe, expect, it } from "vitest";
import {
  PRELAYOUT_TAG_CAP,
  computeVisibleTagCount,
  estimateOverflowPillWidth,
  estimateTagChipWidth,
  mergePartyDisplayTags,
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

describe("mergePartyDisplayTags", () => {
  const tag = (tag_id: string, tag_text: string) => ({ tag_id, tag_text });

  it("puts the requester's chips before the client's", () => {
    const merged = mergePartyDisplayTags([tag("c1", "POC")], [tag("k1", "Gold")]);
    expect(merged.map((t) => t.tag_text)).toEqual(["POC", "Gold"]);
  });

  it("drops a repeat by text so a row never reads VIP VIP", () => {
    const merged = mergePartyDisplayTags([tag("c1", "VIP")], [tag("k1", "vip"), tag("k2", "Gold")]);
    expect(merged.map((t) => t.tag_id)).toEqual(["c1", "k2"]);
  });

  it("tolerates a missing side", () => {
    expect(mergePartyDisplayTags(null, undefined)).toEqual([]);
    expect(mergePartyDisplayTags(undefined, [tag("k1", "Gold")]).map((t) => t.tag_text)).toEqual(["Gold"]);
  });
});
