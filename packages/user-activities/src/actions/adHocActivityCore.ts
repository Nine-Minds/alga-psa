/**
 * Ad-hoc activity core logic.
 *
 * Plain functions that take an explicit `(user, tenant, …)` identity. They contain the
 * full business logic + permission gates for ad-hoc to-do CRUD and are shared by two
 * callers:
 *   - the web app, via the `withAuth`-wrapped exports in `activityServerActions.ts`
 *     (which resolve the user from the NextAuth session), and
 *   - the v1 REST API, which resolves the user from an API key and calls these `*ForApi`
 *     functions directly under `runWithTenant`.
 *
 * IMPORTANT: this module deliberately has NO `'use server'` directive. These functions
 * are unauthenticated by design (the caller supplies the already-resolved identity), so
 * they must never be registered as client-callable server actions.
 */

import type { Knex } from "knex";
import { createTenantKnex, withTransaction } from "@alga-psa/db";
import {
  scheduleEntryToActivity,
  ScheduleActivity,
  IUserWithRoles,
} from "@alga-psa/types";
import { hasPermission } from "@alga-psa/auth";
import { revalidatePath } from "next/cache";

export interface CreateAdHocActivityInput {
  title: string;
  notes?: string;
  /** Optional ISO timestamps — ad-hoc items may have no scheduled time. */
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
}

export interface UpdateAdHocActivityInput {
  title?: string;
  notes?: string | null;
  /** Optional ISO timestamps. Pass null to clear; omit to leave unchanged. */
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
}

export interface AdHocActivityDetails {
  entry_id: string;
  title: string;
  notes: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  status: string;
  assigned_user_ids: string[];
}

/**
 * Parse an optional ISO timestamp from client input. Returns null for an empty value,
 * a valid Date otherwise, and throws on an unparseable string so we never persist an
 * Invalid Date (which the pg driver would otherwise reject with an opaque error).
 */
function parseOptionalTimestamp(value: string | null | undefined, field: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${field}`);
  }
  return date;
}

/**
 * Ensure the caller may modify the given ad-hoc entry: they must be an assignee, or
 * hold the "view/manage other users' schedule" capability (user_schedule:update or
 * user_schedule:read_all) to act on another user's entries. This mirrors the gate used
 * to view another user's activities, so a manager who can see a report's ad-hoc to-do
 * can also mark it done or convert it.
 */
async function assertCanModifyAdHoc(
  trx: Knex.Transaction,
  tenant: string,
  entryId: string,
  user: IUserWithRoles
): Promise<void> {
  const isAssignee = await trx("schedule_entry_assignees")
    .where({ tenant, entry_id: entryId, user_id: user.user_id })
    .first();
  if (!isAssignee) {
    const [canUpdate, canReadAll] = await Promise.all([
      hasPermission(user, "user_schedule", "update", trx),
      hasPermission(user, "user_schedule", "read_all", trx),
    ]);
    if (!canUpdate && !canReadAll) {
      throw new Error("Permission denied: cannot modify another user's ad-hoc item");
    }
  }
}

/**
 * Create an ad-hoc item (a schedule entry with work_item_type='ad_hoc', assigned to the
 * given user). Times are optional — an ad-hoc item is a lightweight personal to-do.
 */
export async function createAdHocActivityForApi(
  user: IUserWithRoles,
  tenant: string,
  input: CreateAdHocActivityInput
): Promise<ScheduleActivity> {
  const title = (input?.title || "").trim();
  if (!title) {
    throw new Error("Title is required");
  }

  // Validate optional times up front so a bad value fails with a clear message instead
  // of an opaque driver error at insert time.
  const scheduledStart = parseOptionalTimestamp(input.scheduledStart, "start time");
  const scheduledEnd = parseOptionalTimestamp(input.scheduledEnd, "end time");
  if (scheduledStart && scheduledEnd && scheduledEnd <= scheduledStart) {
    throw new Error("End time must be after start time");
  }

  const { knex } = await createTenantKnex(tenant);

  // Mirror addScheduleEntry's gate: creating your own schedule entry requires at least
  // user_schedule:read. (Assigning to others needs user_schedule:update, but an ad-hoc
  // item is always self-assigned.)
  if (!(await hasPermission(user, "user_schedule", "read", knex))) {
    throw new Error("Permission denied: cannot create ad-hoc items");
  }

  const created = await withTransaction(knex, async (trx) => {
    const [entry] = await trx("schedule_entries")
      .insert({
        tenant,
        title,
        notes: input.notes?.trim() || null,
        work_item_id: null,
        work_item_type: "ad_hoc",
        status: "scheduled",
        scheduled_start: scheduledStart,
        scheduled_end: scheduledEnd,
        recurrence_pattern: null,
        is_recurring: false,
        is_private: false,
      })
      .returning("*");

    await trx("schedule_entry_assignees").insert({
      tenant,
      entry_id: entry.entry_id,
      user_id: user.user_id,
    });

    return { ...entry, assigned_user_ids: [user.user_id] };
  });

  revalidatePath("/msp/user-activities");
  return scheduleEntryToActivity(created) as ScheduleActivity;
}

/**
 * Fetch a single ad-hoc item by id, independent of any schedule date window.
 * Used by the detail drawer, which can't locate dateless ad-hoc items through the
 * normal date-ranged schedule fetch.
 */
export async function getAdHocActivityForApi(
  _user: IUserWithRoles,
  tenant: string,
  entryId: string
): Promise<AdHocActivityDetails> {
  if (!entryId) {
    throw new Error("Entry id is required");
  }

  const { knex } = await createTenantKnex(tenant);
  const entry = await knex("schedule_entries")
    .where({ tenant, entry_id: entryId, work_item_type: "ad_hoc" })
    .first();
  if (!entry) {
    throw new Error("Ad-hoc item not found");
  }

  const assignees: string[] = await knex("schedule_entry_assignees")
    .where({ tenant, entry_id: entryId })
    .pluck("user_id");

  return {
    entry_id: entry.entry_id,
    title: entry.title,
    notes: entry.notes ?? null,
    scheduled_start: entry.scheduled_start ? new Date(entry.scheduled_start).toISOString() : null,
    scheduled_end: entry.scheduled_end ? new Date(entry.scheduled_end).toISOString() : null,
    status: entry.status,
    assigned_user_ids: assignees,
  };
}

/**
 * Fetch a single ad-hoc item by id and render it as a unified `ScheduleActivity` (the same
 * shape returned by the activity list and by `createAdHocActivityForApi`). Used by the v1
 * API to return the fresh resource after an update / done-toggle so the client gets one
 * consistent Activity shape across all ad-hoc endpoints. Tenant-scoped; callers gate write
 * access separately via `assertCanModifyAdHoc`.
 */
export async function getAdHocActivityAsActivityForApi(
  tenant: string,
  entryId: string
): Promise<ScheduleActivity> {
  if (!entryId) {
    throw new Error("Entry id is required");
  }

  const { knex } = await createTenantKnex(tenant);
  const entry = await knex("schedule_entries")
    .where({ tenant, entry_id: entryId, work_item_type: "ad_hoc" })
    .first();
  if (!entry) {
    throw new Error("Ad-hoc item not found");
  }

  const assigned_user_ids: string[] = await knex("schedule_entry_assignees")
    .where({ tenant, entry_id: entryId })
    .pluck("user_id");

  return scheduleEntryToActivity({ ...entry, assigned_user_ids }) as ScheduleActivity;
}

/**
 * Update an ad-hoc item's title, notes and optional start/end times. Times remain
 * optional for ad-hoc items, but when both are supplied the end must be after the
 * start. The caller must be an assignee, or hold user_schedule:update / read_all.
 */
export async function updateAdHocActivityForApi(
  user: IUserWithRoles,
  tenant: string,
  entryId: string,
  input: UpdateAdHocActivityInput
): Promise<void> {
  if (!entryId) {
    throw new Error("Entry id is required");
  }

  const start = parseOptionalTimestamp(input.scheduledStart, "start time");
  const end = parseOptionalTimestamp(input.scheduledEnd, "end time");
  if (start && end && end <= start) {
    throw new Error("End time must be after start time");
  }

  const { knex } = await createTenantKnex(tenant);
  await withTransaction(knex, async (trx) => {
    const entry = await trx("schedule_entries")
      .where({ tenant, entry_id: entryId, work_item_type: "ad_hoc" })
      .first();
    if (!entry) {
      throw new Error("Ad-hoc item not found");
    }

    await assertCanModifyAdHoc(trx, tenant, entryId, user);

    const patch: Record<string, unknown> = { updated_at: trx.fn.now() };
    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title) {
        throw new Error("Title is required");
      }
      patch.title = title;
    }
    if (input.notes !== undefined) {
      patch.notes = input.notes?.trim() || null;
    }
    if (input.scheduledStart !== undefined) {
      patch.scheduled_start = start;
    }
    if (input.scheduledEnd !== undefined) {
      patch.scheduled_end = end;
    }

    await trx("schedule_entries").where({ tenant, entry_id: entryId }).update(patch);
  });

  revalidatePath("/msp/user-activities");
}

/**
 * Mark an ad-hoc item Done (status='closed') or not done (status='scheduled').
 * The caller must be an assignee of the entry, or hold user_schedule:update to act
 * on another user's entries.
 */
export async function setAdHocActivityDoneForApi(
  user: IUserWithRoles,
  tenant: string,
  entryId: string,
  done: boolean
): Promise<void> {
  if (!entryId) {
    throw new Error("Entry id is required");
  }

  const { knex } = await createTenantKnex(tenant);
  await withTransaction(knex, async (trx) => {
    const entry = await trx("schedule_entries")
      .where({ tenant, entry_id: entryId, work_item_type: "ad_hoc" })
      .first();
    if (!entry) {
      throw new Error("Ad-hoc item not found");
    }

    await assertCanModifyAdHoc(trx, tenant, entryId, user);

    await trx("schedule_entries")
      .where({ tenant, entry_id: entryId })
      .update({ status: done ? "closed" : "scheduled", updated_at: trx.fn.now() });
  });

  revalidatePath("/msp/user-activities");
}

/**
 * Permanently delete an ad-hoc item (and its assignees). The caller must be an assignee,
 * or hold user_schedule:update / read_all.
 */
export async function deleteAdHocActivityForApi(
  user: IUserWithRoles,
  tenant: string,
  entryId: string
): Promise<void> {
  if (!entryId) {
    throw new Error("Entry id is required");
  }

  const { knex } = await createTenantKnex(tenant);
  await withTransaction(knex, async (trx) => {
    const entry = await trx("schedule_entries")
      .where({ tenant, entry_id: entryId, work_item_type: "ad_hoc" })
      .first();
    if (!entry) {
      throw new Error("Ad-hoc item not found");
    }

    await assertCanModifyAdHoc(trx, tenant, entryId, user);

    await trx("schedule_entry_assignees").where({ tenant, entry_id: entryId }).delete();
    await trx("schedule_entries").where({ tenant, entry_id: entryId }).delete();
  });

  revalidatePath("/msp/user-activities");
}
