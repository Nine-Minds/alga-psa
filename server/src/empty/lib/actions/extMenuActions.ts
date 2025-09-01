"use server";

export type AppMenuItem = {
  id: string;
  label: string;
};

// CE stub: no extensions menu items
export async function listAppMenuItemsForTenant(): Promise<AppMenuItem[]> {
  return [];
}
