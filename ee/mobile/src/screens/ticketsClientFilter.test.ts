import { describe, expect, it } from "vitest";
import { withClientFilter } from "./ticketsClientFilter";

describe("withClientFilter", () => {
  it("adds client_id to existing filters", () => {
    expect(withClientFilter({ is_open: true }, "client-1")).toEqual({
      is_open: true,
      client_id: "client-1",
    });
  });

  it("creates a filter object when filters are undefined", () => {
    expect(withClientFilter(undefined, "client-1")).toEqual({ client_id: "client-1" });
  });

  it("returns filters unchanged when clientId is missing", () => {
    const filters = { is_open: true };
    expect(withClientFilter(filters, undefined)).toBe(filters);
    expect(withClientFilter(filters, null)).toBe(filters);
    expect(withClientFilter(filters, "")).toBe(filters);
    expect(withClientFilter(undefined, undefined)).toBeUndefined();
  });

  it("does not mutate the input filters", () => {
    const filters = { is_open: true };
    const merged = withClientFilter(filters, "client-1");
    expect(merged).not.toBe(filters);
    expect(filters).toEqual({ is_open: true });
  });
});
