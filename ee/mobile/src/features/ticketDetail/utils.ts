import type { TicketDetail } from "../../api/tickets";

export function stringOrDash(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : "—";
}

export function extractDescription(ticket: TicketDetail): string | null {
  const attrs = ticket.attributes;
  if (!attrs || typeof attrs !== "object") return null;
  return typeof attrs.description === "string" && attrs.description.trim()
    ? attrs.description.trim()
    : null;
}

export function getTicketAttributes(ticket: TicketDetail): Record<string, unknown> {
  const attrs = ticket.attributes;
  if (!attrs || typeof attrs !== "object") return {};
  return { ...attrs };
}

export function getDueDateIso(ticket: TicketDetail): string | null {
  if (typeof ticket.due_date === "string" && ticket.due_date.trim()) return ticket.due_date;

  const attrs = ticket.attributes;
  if (!attrs || typeof attrs !== "object") return null;
  return typeof attrs.due_date === "string" && attrs.due_date.trim() ? attrs.due_date : null;
}

export function getWatcherUserIds(ticket: TicketDetail): string[] {
  const attrs = ticket.attributes;
  if (!attrs || typeof attrs !== "object") return [];
  const raw = attrs.watcher_user_ids;
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

export function isoToDateInput(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function dateInputToIso(input: string): string | null {
  const trimmed = input.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const d = new Date(`${trimmed}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function getApiErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const error = (body as any).error as unknown;
  if (!error || typeof error !== "object") return null;
  const message = (error as any).message as unknown;
  const trimmed = typeof message === "string" ? message.trim() : "";

  const details = (error as any).details as unknown;
  const detailMessage = (() => {
    if (!details) return null;
    if (typeof details === "string" && details.trim()) return details.trim();
    if (Array.isArray(details) && details.length > 0) {
      const first = details[0] as any;
      const msg = typeof first?.message === "string" ? first.message.trim() : "";
      const path = Array.isArray(first?.path) ? first.path.filter((p: any) => typeof p === "string" || typeof p === "number").join(".") : "";
      if (!msg) return null;
      return path ? `${path}: ${msg}` : msg;
    }
    return null;
  })();

  if (detailMessage) return detailMessage;
  return trimmed ? trimmed : null;
}

export function parseHHMM(hhmm: string): { hours: number; minutes: number } | null {
  const match = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

export function toMinutesOfDay(hhmm: string): number | null {
  const parsed = parseHHMM(hhmm);
  return parsed ? parsed.hours * 60 + parsed.minutes : null;
}

export function minutesToHHMM(totalMin: number): string {
  const h = Math.floor(totalMin / 60) % 24;
  const m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
