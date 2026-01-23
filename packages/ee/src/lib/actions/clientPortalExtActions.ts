"use server";

export type ClientPortalMenuItem = {
  id: string;
  label: string;
};

export async function listClientPortalMenuItemsForTenant(): Promise<ClientPortalMenuItem[]> {
  return [];
}
