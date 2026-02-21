export interface EntraCippCredentials {
  baseUrl: string;
  apiToken: string;
}

export async function saveEntraCippCredentials(
  _tenant: string,
  _credentials: EntraCippCredentials
): Promise<void> {
  return;
}

export async function getEntraCippCredentials(
  _tenant: string
): Promise<EntraCippCredentials | null> {
  return null;
}

export async function clearEntraCippCredentials(_tenant: string): Promise<void> {
  return;
}
