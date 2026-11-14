import type { TicketCategory, TicketDetail } from "../../api/tickets";

/**
 * Ticket classification is stored as a parent/child pair: category_id always
 * holds the parent and subcategory_id its child. Picking a node therefore
 * writes both columns, mirroring the web picker (pattern
 * ticket-category-selection in TicketInfo.handleCategoryChange).
 */
export type TicketCategorySelection = {
  category_id: string | null;
  subcategory_id: string | null;
};

export type TicketCategoryGroup = {
  parent: TicketCategory;
  children: TicketCategory[];
};

/** Parents in server order, each with its own children. */
export function groupTicketCategories(categories: TicketCategory[]): TicketCategoryGroup[] {
  const parents = categories.filter((category) => !category.parent_category);
  return parents.map((parent) => ({
    parent,
    children: categories.filter((category) => category.parent_category === parent.category_id),
  }));
}

/** The node the pickers highlight: the subcategory when set, else the category. */
export function selectedTicketCategoryId(
  ticket: Pick<TicketDetail, "category_id" | "subcategory_id">,
): string | null {
  return ticket.subcategory_id ?? ticket.category_id ?? null;
}

/** Maps a picked node to the pair the ticket update expects. */
export function ticketCategorySelection(
  categories: TicketCategory[],
  categoryId: string | null,
): TicketCategorySelection {
  if (!categoryId) return { category_id: null, subcategory_id: null };

  const picked = categories.find((category) => category.category_id === categoryId);
  if (picked?.parent_category) {
    return { category_id: picked.parent_category, subcategory_id: categoryId };
  }
  return { category_id: categoryId, subcategory_id: null };
}

export function isSameTicketCategorySelection(
  a: TicketCategorySelection,
  b: TicketCategorySelection,
): boolean {
  return (a.category_id ?? null) === (b.category_id ?? null)
    && (a.subcategory_id ?? null) === (b.subcategory_id ?? null);
}

/**
 * "Hardware › Laptop" from the names the ticket detail joins in, so the row
 * reads correctly before the category list is fetched.
 */
export function ticketCategoryLabel(
  ticket: Pick<TicketDetail, "category_name" | "subcategory_name">,
): string | null {
  const category = typeof ticket.category_name === "string" ? ticket.category_name.trim() : "";
  const subcategory = typeof ticket.subcategory_name === "string" ? ticket.subcategory_name.trim() : "";
  if (!category && !subcategory) return null;
  if (!subcategory) return category;
  if (!category) return subcategory;
  return `${category} › ${subcategory}`;
}
