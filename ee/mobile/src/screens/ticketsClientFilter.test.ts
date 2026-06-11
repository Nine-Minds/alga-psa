import { describe, expect, it } from "vitest";
import { withClientFilter, withContactFilter } from "./ticketsClientFilter";

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

describe("withContactFilter", () => {
  it("adds contact_name_id to existing filters", () => {
    expect(withContactFilter({ is_open: true }, "contact-1")).toEqual({
      is_open: true,
      contact_name_id: "contact-1",
    });
  });

  it("creates a filter object when filters are undefined", () => {
    expect(withContactFilter(undefined, "contact-1")).toEqual({ contact_name_id: "contact-1" });
  });

  it("returns filters unchanged when contactId is missing", () => {
    const filters = { is_open: true };
    expect(withContactFilter(filters, undefined)).toBe(filters);
    expect(withContactFilter(filters, null)).toBe(filters);
    expect(withContactFilter(filters, "")).toBe(filters);
    expect(withContactFilter(undefined, undefined)).toBeUndefined();
  });

  it("does not mutate the input filters", () => {
    const filters = { is_open: true };
    const merged = withContactFilter(filters, "contact-1");
    expect(merged).not.toBe(filters);
    expect(filters).toEqual({ is_open: true });
  });

  it("composes with the client filter", () => {
    expect(withContactFilter(withClientFilter({ is_open: true }, "client-1"), "contact-1")).toEqual({
      is_open: true,
      client_id: "client-1",
      contact_name_id: "contact-1",
    });
    expect(withContactFilter(withClientFilter(undefined, undefined), "contact-1")).toEqual({
      contact_name_id: "contact-1",
    });
  });
});
