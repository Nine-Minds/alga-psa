export interface EntraDirectTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scope: string | null;
}

export async function saveEntraDirectTokenSet(
  _tenant: string,
  _tokens: EntraDirectTokenSet
): Promise<void> {
  return;
}

export async function getEntraDirectRefreshToken(_tenant: string): Promise<string | null> {
  return null;
}

export async function clearEntraDirectTokenSet(_tenant: string): Promise<void> {
  return;
}
