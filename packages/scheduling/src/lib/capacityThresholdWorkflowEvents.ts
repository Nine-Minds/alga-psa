import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IScheduleEntry } from '@alga-psa/types';
import { publishWorkflowEvent as publishWorkflowEventDefault } from '@alga-psa/event-bus/publishers';
import { buildCapacityThresholdReachedPayload } from '@alga-psa/workflow-streams';
import { didCrossThreshold, getOverlapHoursForUtcDate, getUtcDatesOverlappedByInterval, utcStartOfDayIso } from './capacityThresholdMath';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

type CapacityThresholdDeps = {
  now: () => Date;
  publishWorkflowEvent: typeof publishWorkflowEventDefault;
  getTeamIdsForUsers: typeof getTeamIdsForUsers;
  getTeamMembershipForUsers: typeof getTeamMembershipForUsers;
  getTeamDailyCapacityLimitHours: typeof getTeamDailyCapacityLimitHours;
  getTeamDailyBookedHours: typeof getTeamDailyBookedHours;
};

function tenantScopedTable(conn: Knex | Knex.Transaction, table: string, tenant: string): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

async function getTeamIdsForUsers(db: Knex, tenant: string, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await tenantScopedTable(db, 'team_members', tenant)
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

  const rows = await tenantScopedTable(db, 'team_members', tenant)
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
  const facade = tenantDb(db, tenant);
  const capacityQuery = tenantScopedTable(db, 'team_members as tm', tenant)
    .where({ 'tm.team_id': teamId, 'u.is_inactive': false });
  facade.tenantJoin(capacityQuery, 'resources as r', 'r.user_id', 'tm.user_id', { type: 'left' });
  facade.tenantJoin(capacityQuery, 'users as u', 'tm.user_id', 'u.user_id');
  const row = await capacityQuery
    .sum({ capacityLimit: db.raw('COALESCE(r.max_daily_capacity, 0)') })
    .first();

  const capacityLimit = Number((row as any)?.capacityLimit ?? 0);
  return Number.isFinite(capacityLimit) ? capacityLimit : 0;
}

async function getTeamDailyBookedHours(db: Knex, tenant: string, teamId: string, dateString: string): Promise<number> {
  const dayStart = utcStartOfDayIso(dateString);
  const dayEnd = new Date(new Date(dayStart).getTime() + 24 * 60 * 60 * 1000).toISOString();

  const bookedQuery = tenantScopedTable(db, 'schedule_entry_assignees as sea', tenant)
    .where({ 'tm.team_id': teamId })
    .andWhere('se.scheduled_start', '<', dayEnd)
    .andWhere('se.scheduled_end', '>', dayStart);
  const facade = tenantDb(db, tenant);
  facade.tenantJoin(bookedQuery, 'schedule_entries as se', 'sea.entry_id', 'se.entry_id');
  facade.tenantJoin(bookedQuery, 'team_members as tm', 'tm.user_id', 'sea.user_id');
  const row = await bookedQuery
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
  __deps?: Partial<CapacityThresholdDeps>;
}): Promise<void> {
  const deps: CapacityThresholdDeps = {
    now: () => new Date(),
    publishWorkflowEvent: publishWorkflowEventDefault,
    getTeamIdsForUsers,
    getTeamMembershipForUsers,
    getTeamDailyCapacityLimitHours,
    getTeamDailyBookedHours,
    ...params.__deps,
  };

  const beforeAssignees = params.before?.assigned_user_ids ?? [];
  const afterAssignees = params.after?.assigned_user_ids ?? [];
  const impactedUserIds = Array.from(new Set([...beforeAssignees, ...afterAssignees]));
  if (impactedUserIds.length === 0) return;

  const teamIds = await deps.getTeamIdsForUsers(params.db, params.tenantId, impactedUserIds);
  if (teamIds.length === 0) return;

  const membership = await deps.getTeamMembershipForUsers(params.db, params.tenantId, teamIds, impactedUserIds);

  const beforeHoursByDate = params.before ? getEntryDatesAndOverlapHours(params.before) : new Map<string, number>();
  const afterHoursByDate = params.after ? getEntryDatesAndOverlapHours(params.after) : new Map<string, number>();
  const impactedDates = Array.from(new Set([...beforeHoursByDate.keys(), ...afterHoursByDate.keys()]));
  if (impactedDates.length === 0) return;

  for (const teamId of teamIds) {
    const members = membership.get(teamId) ?? new Set<string>();
    if (members.size === 0) continue;

    const capacityLimit = await deps.getTeamDailyCapacityLimitHours(params.db, params.tenantId, teamId);
    if (capacityLimit <= 0) continue;

    const beforeCount = beforeAssignees.filter((id) => members.has(id)).length;
    const afterCount = afterAssignees.filter((id) => members.has(id)).length;

    for (const date of impactedDates) {
      const currentBooked = await deps.getTeamDailyBookedHours(params.db, params.tenantId, teamId, date);

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

        await deps.publishWorkflowEvent({
          eventType: 'CAPACITY_THRESHOLD_REACHED',
          ctx,
          payload: buildCapacityThresholdReachedPayload({
            teamId,
            date,
            capacityLimit: round2(capacityLimit),
            currentBooked: round2(currentBooked),
            triggeredAt: deps.now().toISOString(),
          }),
        });
      }
    }
  }
}
