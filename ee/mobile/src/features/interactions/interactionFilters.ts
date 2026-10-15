export type InteractionScope = "mine" | "everyone";
export type InteractionStatusFilter = "any" | "open" | "closed";
export type InteractionWhenFilter = "any" | "today" | "thisWeek" | "upcoming" | "past30";

export type InteractionFilters = {
  scope: InteractionScope;
  status: InteractionStatusFilter;
  when: InteractionWhenFilter;
  typeId: string | null;
};

export const DEFAULT_INTERACTION_FILTERS: InteractionFilters = {
  scope: "mine",
  status: "any",
  when: "any",
  typeId: null,
};

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Local-day window for a "when" preset, expressed as ISO instants for the API. */
export function whenToDateRange(when: InteractionWhenFilter, now: Date = new Date()): { dateFrom?: string; dateTo?: string } {
  const today = startOfDay(now);
  const endOfToday = new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1);
  switch (when) {
    case "today":
      return { dateFrom: today.toISOString(), dateTo: endOfToday.toISOString() };
    case "thisWeek": {
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
      const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
      return { dateFrom: weekStart.toISOString(), dateTo: weekEnd.toISOString() };
    }
    case "upcoming":
      return { dateFrom: now.toISOString() };
    case "past30":
      return { dateFrom: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(), dateTo: now.toISOString() };
    default:
      return {};
  }
}

export function filtersToQuery(
  filters: InteractionFilters,
  meUserId: string | null | undefined,
  now: Date = new Date(),
): { userId?: string; typeId?: string; isClosed?: boolean; dateFrom?: string; dateTo?: string } {
  return {
    ...(filters.scope === "mine" && meUserId ? { userId: meUserId } : {}),
    ...(filters.typeId ? { typeId: filters.typeId } : {}),
    ...(filters.status === "open" ? { isClosed: false } : filters.status === "closed" ? { isClosed: true } : {}),
    ...whenToDateRange(filters.when, now),
  };
}

export function hasActiveInteractionFilters(filters: InteractionFilters): boolean {
  return filters.status !== "any" || filters.when !== "any" || filters.typeId !== null;
}
