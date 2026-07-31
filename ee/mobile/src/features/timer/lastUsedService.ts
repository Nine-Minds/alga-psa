import { getSecureJson, setSecureJson } from "../../storage/secureStorage";
import type { ServiceOption } from "../../api/timeEntries";

const KEY_PREFIX = "alga.mobile.timer.lastService.";

export async function getLastUsedService(userId: string): Promise<ServiceOption | null> {
  const stored = await getSecureJson<ServiceOption>(`${KEY_PREFIX}${userId}`);
  if (!stored || typeof stored.service_id !== "string" || !stored.service_id) return null;
  return stored;
}

export async function setLastUsedService(userId: string, service: ServiceOption): Promise<void> {
  await setSecureJson(`${KEY_PREFIX}${userId}`, service);
}
