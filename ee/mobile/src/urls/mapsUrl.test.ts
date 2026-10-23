import { describe, expect, it } from "vitest";
import { buildMapsUrl, mapsQueryFromLines } from "./mapsUrl";

describe("buildMapsUrl", () => {
  it("targets Apple Maps on iOS and the geo intent elsewhere", () => {
    expect(buildMapsUrl("1 Main St, Springfield", "ios")).toBe("maps:0,0?q=1%20Main%20St%2C%20Springfield");
    expect(buildMapsUrl("1 Main St, Springfield", "android")).toBe("geo:0,0?q=1%20Main%20St%2C%20Springfield");
  });

  it("trims and encodes the query", () => {
    expect(buildMapsUrl("  Rabbit Hole & Co  ", "ios")).toBe("maps:0,0?q=Rabbit%20Hole%20%26%20Co");
  });
});

describe("mapsQueryFromLines", () => {
  it("joins address lines into one comma-separated search string", () => {
    expect(mapsQueryFromLines("1 Main St\n\nSpringfield, IL, 62701\nUnited States")).toBe(
      "1 Main St, Springfield, IL, 62701, United States",
    );
  });
});
