import type { Knex } from 'knex';
import type { IScheduleEntry } from '@alga-psa/types';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildCapacityThresholdReachedPayload } from '@shared/workflow/streams/domainEventBuilders/capacityThresholdEventBuilders';
import { didCrossThreshold, getOverlapHoursForUtcDate, getUtcDatesOverlappedByInterval, utcStartOfDayIso } from './capacityThresholdMath';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

async function getTeamIdsForUsers(db: Knex, tenant: string, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await db('team_members')
    .where({ tenant })
    .whereIn('user_id', userIds)
    .distinct('team_id');
  return rows.map((r: any) => r.team_id);
}

async function getTeamMembershipForUsers(
  db: Knex,
  tenant: string,
  teamIds: string[],
  userIds: string[]
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  for (const teamId of teamIds) map.set(teamId, new Set());
  if (teamIds.length === 0 || userIds.length === 0) return map;

  const rows = await db('team_members')
    .where({ tenant })
    .whereIn('team_id', teamIds)
    .whereIn('user_id', userIds)
    .select('team_id', 'user_id');

  for (const row of rows as any[]) {
    const set = map.get(row.team_id);
    if (set) set.add(row.user_id);
  }
  return map;
}

async function getTeamDailyCapacityLimitHours(db: Knex, tenant: string, teamId: string): Promise<number> {
  const row = await db('team_members as tm')
    .join('users as u', function () {
      this.on('tm.user_id', '=', 'u.user_id').andOn('tm.tenant', '=', 'u.tenant');
    })
    .leftJoin('resources as r', function () {
      this.on('r.user_id', '=', 'tm.user_id').andOn('r.tenant', '=', 'tm.tenant');
    })
    .where({ 'tm.tenant': tenant, 'tm.team_id': teamId, 'u.is_inactive': false })
    .sum({ capacityLimit: db.raw('COALESCE(r.max_daily_capacity, 0)') })
    .first();

  const capacityLimit = Number((row as any)?.capacityLimit ?? 0);
  return Number.isFinite(capacityLimit) ? capacityLimit : 0;
}

async function getTeamDailyBookedHours(db: Knex, tenant: string, teamId: string, dateString: string): Promise<number> {
  const dayStart = utcStartOfDayIso(dateString);
  const dayEnd = new Date(new Date(dayStart).getTime() + 24 * 60 * 60 * 1000).toISOString();

  const row = await db('schedule_entry_assignees as sea')
    .join('schedule_entries as se', function () {
      this.on('sea.entry_id', '=', 'se.entry_id').andOn('sea.tenant', '=', 'se.tenant');
    })
    .join('team_members as tm', function () {
      this.on('tm.user_id', '=', 'sea.user_id')
        .andOn('tm.tenant', '=', 'sea.tenant')
        .andOn('tm.team_id', '=', db.raw('?', [teamId]));
    })
    .where({ 'sea.tenant': tenant })
    .andWhere('se.scheduled_start', '<', dayEnd)
    .andWhere('se.scheduled_end', '>', dayStart)
    .sum({
      bookedHours: db.raw(
        `GREATEST(
          0,
          EXTRACT(EPOCH FROM (LEAST(se.scheduled_end, ?) - GREATEST(se.scheduled_start, ?)))
        ) / 3600`,
        [dayEnd, dayStart]
      ),
    })
    .first();

  const bookedHours = Number((row as any)?.bookedHours ?? 0);
  return Number.isFinite(bookedHours) ? bookedHours : 0;
}

function getEntryDatesAndOverlapHours(entry: Pick<IScheduleEntry, 'scheduled_start' | 'scheduled_end'>): Map<string, number> {
  const start = new Date(entry.scheduled_start);
  const end = new Date(entry.scheduled_end);
  const dates = getUtcDatesOverlappedByInterval(start, end);
  const map = new Map<string, number>();
  for (const date of dates) {
    map.set(date, getOverlapHoursForUtcDate(start, end, date));
  }
  return map;
}

export async function maybePublishCapacityThresholdReached(params: {
  db: Knex;
  tenantId: string;
  actorUserId: string;
  before?: Pick<IScheduleEntry, 'scheduled_start' | 'scheduled_end' | 'assigned_user_ids'>;
  after?: Pick<IScheduleEntry, 'scheduled_start' | 'scheduled_end' | 'assigned_user_ids'>;
}): Promise<void> {
  const beforeAssignees = params.before?.assigned_user_ids ?? [];
  const afterAssignees = params.after?.assigned_user_ids ?? [];
  const impactedUserIds = Array.from(new Set([...beforeAssignees, ...afterAssignees]));
  if (impactedUserIds.length === 0) return;

  const teamIds = await getTeamIdsForUsers(params.db, params.tenantId, impactedUserIds);
  if (teamIds.length === 0) return;

  const membership = await getTeamMembershipForUsers(params.db, params.tenantId, teamIds, impactedUserIds);

  const beforeHoursByDate = params.before ? getEntryDatesAndOverlapHours(params.before) : new Map<string, number>();
  const afterHoursByDate = params.after ? getEntryDatesAndOverlapHours(params.after) : new Map<string, number>();
  const impactedDates = Array.from(new Set([...beforeHoursByDate.keys(), ...afterHoursByDate.keys()]));
  if (impactedDates.length === 0) return;

  for (const teamId of teamIds) {
    const members = membership.get(teamId) ?? new Set<string>();
    if (members.size === 0) continue;

    const capacityLimit = await getTeamDailyCapacityLimitHours(params.db, params.tenantId, teamId);
    if (capacityLimit <= 0) continue;

    const beforeCount = beforeAssignees.filter((id) => members.has(id)).length;
    const afterCount = afterAssignees.filter((id) => members.has(id)).length;

    for (const date of impactedDates) {
      const currentBooked = await getTeamDailyBookedHours(params.db, params.tenantId, teamId, date);

      const beforeEntryHours = (beforeHoursByDate.get(date) ?? 0) * beforeCount;
      const afterEntryHours = (afterHoursByDate.get(date) ?? 0) * afterCount;
      const deltaHours = afterEntryHours - beforeEntryHours;
      const previousBooked = currentBooked - deltaHours;

      if (
        didCrossThreshold({
          capacityLimit,
          previousBooked,
          currentBooked,
        })
      ) {
        const ctx = {
          tenantId: params.tenantId,
          actor: { actorType: 'USER' as const, actorUserId: params.actorUserId },
          idempotencyKey: `capacity-threshold-reached:${teamId}:${date}`,
        };

        await publishWorkflowEvent({
          eventType: 'CAPACITY_THRESHOLD_REACHED',
          ctx,
          payload: buildCapacityThresholdReachedPayload({
            teamId,
            date,
            capacityLimit: round2(capacityLimit),
            currentBooked: round2(currentBooked),
            triggeredAt: new Date().toISOString(),
          }),
        });
      }
    }
  }
}
