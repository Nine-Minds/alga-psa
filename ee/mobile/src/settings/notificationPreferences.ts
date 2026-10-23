import { getSecureJson, secureStorage, setSecureJson } from "../storage/secureStorage";

/** Lowest in-app notification priority this device wants pushed. 'low' = everything. */
export type PushPriorityThreshold = "low" | "normal" | "high";

export const PUSH_PRIORITY_THRESHOLDS: PushPriorityThreshold[] = ["low", "normal", "high"];
export const DEFAULT_PUSH_PRIORITY_THRESHOLD: PushPriorityThreshold = "low";

/** Minutes before a schedule entry starts that a local reminder fires. */
export const REMINDER_LEAD_OPTIONS_MINUTES = [5, 10, 15, 30, 60] as const;
export const DEFAULT_REMINDER_LEAD_MINUTES: number[] = [15];

const THRESHOLD_KEY = "alga.mobile.settings.pushPriorityThreshold";
const REMINDER_LEADS_KEY = "alga.mobile.settings.scheduleReminderLeadMinutes";

export function isPushPriorityThreshold(value: unknown): value is PushPriorityThreshold {
  return typeof value === "string" && (PUSH_PRIORITY_THRESHOLDS as string[]).includes(value);
}

export async function getPushPriorityThreshold(): Promise<PushPriorityThreshold> {
  const value = await secureStorage.getItem(THRESHOLD_KEY);
  return isPushPriorityThreshold(value) ? value : DEFAULT_PUSH_PRIORITY_THRESHOLD;
}

export async function setPushPriorityThreshold(value: PushPriorityThreshold): Promise<void> {
  await secureStorage.setItem(THRESHOLD_KEY, value);
}

/** Sorted, de-duplicated, limited to the supported options; empty = reminders off. */
export function normalizeReminderLeads(value: unknown): number[] {
  if (!Array.isArray(value)) return [...DEFAULT_REMINDER_LEAD_MINUTES];
  const allowed = new Set<number>(REMINDER_LEAD_OPTIONS_MINUTES);
  const leads = value.filter((v): v is number => typeof v === "number" && allowed.has(v));
  return [...new Set(leads)].sort((a, b) => b - a);
}

export async function getReminderLeadMinutes(): Promise<number[]> {
  const stored = await getSecureJson<unknown>(REMINDER_LEADS_KEY);
  if (stored === null || stored === undefined) return [...DEFAULT_REMINDER_LEAD_MINUTES];
  return normalizeReminderLeads(stored);
}

export async function setReminderLeadMinutes(leads: number[]): Promise<void> {
  await setSecureJson(REMINDER_LEADS_KEY, normalizeReminderLeads(leads));
}
