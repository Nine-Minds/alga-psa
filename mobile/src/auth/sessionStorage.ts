import { getSecureJson, secureStorage, setSecureJson } from "../storage/secureStorage";
import type { MobileSession } from "./AuthContext";

const SESSION_KEY = "alga.mobile.session";

export async function getStoredSession(): Promise<MobileSession | null> {
  return getSecureJson<MobileSession>(SESSION_KEY);
}

export async function storeSession(session: MobileSession): Promise<void> {
  await setSecureJson(SESSION_KEY, session);
}

export async function clearStoredSession(): Promise<void> {
  await secureStorage.deleteItem(SESSION_KEY);
}

