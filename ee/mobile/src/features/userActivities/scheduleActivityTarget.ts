import type { Activity } from "../../api/activities";
import { isAdHocActivity } from "../../api/activities";

/**
 * Where tapping a `schedule`-type activity should go.
 *
 * Opportunity next-action activities reuse the `schedule` activity type (there is
 * no dedicated OPPORTUNITY type) but are NOT schedule entries — their id/workItemId
 * is the opportunity_id. Routing them like a schedule entry lands on an empty
 * calendar (mobile) or throws "Schedule entry not found" (web). They must route to
 * the deal instead.
 */
export type ScheduleActivityTarget =
  | { kind: "adhoc" }
  | { kind: "opportunity"; opportunityId: string; title: string }
  | { kind: "ticket"; ticketId: string }
  | { kind: "calendar" };

export function scheduleActivityTarget(activity: Activity): ScheduleActivityTarget {
  if (isAdHocActivity(activity)) return { kind: "adhoc" };
  const workItemType = (activity as { workItemType?: string }).workItemType;
  const workItemId = (activity as { workItemId?: string }).workItemId;
  if (workItemType === "opportunity" && workItemId) {
    return { kind: "opportunity", opportunityId: workItemId, title: activity.title };
  }
  if (workItemType === "ticket" && workItemId) {
    return { kind: "ticket", ticketId: workItemId };
  }
  return { kind: "calendar" };
}
