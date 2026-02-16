import * as ExpoLinking from "expo-linking";
import { getSecureJson, secureStorage, setSecureJson } from "../storage/secureStorage";

export type PendingMobileAuth = {
  state: string;
  createdAtMs: number;
};

export type ReceivedOtt = {
  ott: string;
  state: string;
  receivedAtMs: number;
};

const PENDING_KEY = "alga.mobile.auth.pending";
const OTT_KEY = "alga.mobile.auth.ott";

function generateState(): string {
  const a = Math.random().toString(36).slice(2);
  const b = Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}.${a}.${b}`;
}

export async function createPendingMobileAuth(): Promise<PendingMobileAuth> {
  const pending: PendingMobileAuth = { state: generateState(), createdAtMs: Date.now() };
  await setSecureJson(PENDING_KEY, pending);
  return pending;
}

export async function getPendingMobileAuth(): Promise<PendingMobileAuth | null> {
  return getSecureJson<PendingMobileAuth>(PENDING_KEY);
}

export async function clearPendingMobileAuth(): Promise<void> {
  await secureStorage.deleteItem(PENDING_KEY);
}

export async function storeReceivedOtt(ott: string, state: string): Promise<void> {
  const received: ReceivedOtt = { ott, state, receivedAtMs: Date.now() };
  await setSecureJson(OTT_KEY, received);
}

export async function getReceivedOtt(): Promise<ReceivedOtt | null> {
  return getSecureJson<ReceivedOtt>(OTT_KEY);
}

export async function clearReceivedOtt(): Promise<void> {
  await secureStorage.deleteItem(OTT_KEY);
}

export function getAuthCallbackRedirectUri(): string {
  return ExpoLinking.createURL("auth/callback");
}

export function buildWebSignInUrl({
  baseUrl,
  redirectUri,
  state,
}: {
  baseUrl: string;
  redirectUri: string;
  state: string;
}): string {
  const handoff = new URL("/auth/mobile/handoff", baseUrl);
  handoff.searchParams.set("redirect", redirectUri);
  handoff.searchParams.set("state", state);

  const signIn = new URL("/auth/signin", baseUrl);
  signIn.searchParams.set("callbackUrl", handoff.toString());
  return signIn.toString();
}

export function parseAuthCallback(inputUrl: string): { ott?: string; state?: string; error?: string } {
  const url = new URL(inputUrl);
  const host = url.host;
  const path = url.pathname;

  const looksLikeAuthCallback =
    (host === "auth" && path === "/callback") || url.pathname.endsWith("/auth/callback");

  if (!looksLikeAuthCallback) return {};

  return {
    ott: url.searchParams.get("ott") ?? undefined,
    state: url.searchParams.get("state") ?? undefined,
    error: url.searchParams.get("error") ?? undefined,
  };
}

