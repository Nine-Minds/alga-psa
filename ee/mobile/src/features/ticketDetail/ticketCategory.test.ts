import { describe, expect, it } from "vitest";
import {
  groupTicketCategories,
  isSameTicketCategorySelection,
  selectedTicketCategoryId,
  ticketCategoryLabel,
  ticketCategorySelection,
} from "./ticketCategory";
import type { TicketCategory } from "../../api/tickets";

const categories: TicketCategory[] = [
  { category_id: "hardware", category_name: "Hardware", parent_category: null },
  { category_id: "laptop", category_name: "Laptop", parent_category: "hardware" },
  { category_id: "printer", category_name: "Printer", parent_category: "hardware" },
  { category_id: "network", category_name: "Network", parent_category: null },
];

describe("groupTicketCategories", () => {
  it("keeps parents in server order with their own children", () => {
    expect(groupTicketCategories(categories)).toEqual([
      { parent: categories[0], children: [categories[1], categories[2]] },
      { parent: categories[3], children: [] },
    ]);
  });
});

describe("ticketCategorySelection", () => {
  it("writes the parent into category_id and the child into subcategory_id", () => {
    expect(ticketCategorySelection(categories, "laptop")).toEqual({
      category_id: "hardware",
      subcategory_id: "laptop",
    });
  });

  it("clears a stale subcategory when a parent is picked", () => {
    expect(ticketCategorySelection(categories, "network")).toEqual({
      category_id: "network",
      subcategory_id: null,
    });
  });

  it("clears both sides when nothing is selected", () => {
    expect(ticketCategorySelection(categories, null)).toEqual({
      category_id: null,
      subcategory_id: null,
    });
  });

  it("treats an id missing from the list as a parent", () => {
    expect(ticketCategorySelection(categories, "ghost")).toEqual({
      category_id: "ghost",
      subcategory_id: null,
    });
  });
});

describe("selectedTicketCategoryId", () => {
  it("prefers the subcategory, then the category", () => {
    expect(selectedTicketCategoryId({ category_id: "hardware", subcategory_id: "laptop" })).toBe("laptop");
    expect(selectedTicketCategoryId({ category_id: "hardware", subcategory_id: null })).toBe("hardware");
    expect(selectedTicketCategoryId({ category_id: null, subcategory_id: null })).toBeNull();
  });
});

describe("ticketCategoryLabel", () => {
  it("joins the pair and falls back to whichever name exists", () => {
    expect(ticketCategoryLabel({ category_name: "Hardware", subcategory_name: "Laptop" })).toBe("Hardware › Laptop");
    expect(ticketCategoryLabel({ category_name: "Hardware", subcategory_name: null })).toBe("Hardware");
    expect(ticketCategoryLabel({ category_name: null, subcategory_name: null })).toBeNull();
  });
});

describe("isSameTicketCategorySelection", () => {
  it("treats missing and null the same", () => {
    expect(isSameTicketCategorySelection(
      { category_id: "hardware", subcategory_id: null },
      { category_id: "hardware", subcategory_id: null },
    )).toBe(true);
    expect(isSameTicketCategorySelection(
      { category_id: "hardware", subcategory_id: "laptop" },
      { category_id: "hardware", subcategory_id: null },
    )).toBe(false);
  });
});
