import { describe, expect, it } from "vitest";
import { addTagFilter, normalizeSavedTags, removeTagFilter, withTagsFilter } from "./ticketsTagsFilter";

describe("withTagsFilter", () => {
  it("joins tags into a comma-separated filter", () => {
    expect(withTagsFilter({ is_open: true }, ["vip", "billing"])).toEqual({
      is_open: true,
      tags: "vip,billing",
    });
  });

  it("creates a filter object when filters are undefined", () => {
    expect(withTagsFilter(undefined, ["vip"])).toEqual({ tags: "vip" });
  });

  it("returns filters unchanged when tags are empty or missing", () => {
    const filters = { is_open: true };
    expect(withTagsFilter(filters, [])).toBe(filters);
    expect(withTagsFilter(filters, undefined)).toBe(filters);
    expect(withTagsFilter(undefined, [])).toBeUndefined();
  });

  it("drops blank entries and trims the rest", () => {
    expect(withTagsFilter({}, [" vip ", "", "  "])).toEqual({ tags: "vip" });
    const filters = { is_open: true };
    expect(withTagsFilter(filters, ["", "  "])).toBe(filters);
  });

  it("does not mutate the input filters", () => {
    const filters = { is_open: true };
    const merged = withTagsFilter(filters, ["vip"]);
    expect(merged).not.toBe(filters);
    expect(filters).toEqual({ is_open: true });
  });
});

describe("normalizeSavedTags", () => {
  it("returns an empty list for saved filters without the tags field", () => {
    const saved = { status: "open", statusIds: [] } as Record<string, unknown>;
    expect(normalizeSavedTags(saved.tags)).toEqual([]);
  });

  it("returns an empty list for non-array values", () => {
    expect(normalizeSavedTags(undefined)).toEqual([]);
    expect(normalizeSavedTags(null)).toEqual([]);
    expect(normalizeSavedTags("vip")).toEqual([]);
    expect(normalizeSavedTags(42)).toEqual([]);
  });

  it("keeps only non-empty strings, trimmed", () => {
    expect(normalizeSavedTags(["vip", 1, null, " billing ", ""])).toEqual(["vip", "billing"]);
  });

  it("dedupes case-insensitively, keeping the first casing", () => {
    expect(normalizeSavedTags(["VIP", "vip", "Vip"])).toEqual(["VIP"]);
  });
});

describe("addTagFilter", () => {
  it("appends a new tag", () => {
    expect(addTagFilter(["vip"], "billing")).toEqual(["vip", "billing"]);
  });

  it("dedupes case-insensitively", () => {
    const tags = ["VIP"];
    expect(addTagFilter(tags, "vip")).toBe(tags);
  });

  it("ignores blank input", () => {
    const tags = ["vip"];
    expect(addTagFilter(tags, "  ")).toBe(tags);
  });
});

describe("removeTagFilter", () => {
  it("removes a tag case-insensitively", () => {
    expect(removeTagFilter(["VIP", "billing"], "vip")).toEqual(["billing"]);
  });

  it("returns the same array when nothing matches", () => {
    const tags = ["vip"];
    expect(removeTagFilter(tags, "billing")).toBe(tags);
  });
});
