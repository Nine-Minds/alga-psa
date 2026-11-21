'use server';

// CE stub: there is no commercial discovery in the community edition.
export async function getCoManagedPurchaseDiscoveryAction(): Promise<boolean> {
  return false;
}
