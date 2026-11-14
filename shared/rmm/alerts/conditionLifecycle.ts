import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { NormalizedRmmAlertEvent, RmmAlertProcessingContext } from './contracts';

export interface ConditionObservation {
  scopeKey: string;
  subjectKey: string;
  conditionKey: string;
  evidence: 'failing' | 'healthy' | 'uncertain';
  observedAt: string;
  /** A trustworthy provider-side start time, when one exists. */
  failingSince?: string | null;
  event: Omit<NormalizedRmmAlertEvent, 'kind' | 'externalAlertId' | 'occurredAt'>;
}

export interface ConditionTransitionResult {
  events: NormalizedRmmAlertEvent[];
  heldExternalAlertIds: string[];
  staleObservations: number;
}

type ConditionRow = {
  scope_key: string;
  subject_key: string;
  condition_key: string;
  state: 'pending' | 'firing' | 'healthy' | 'unmanaged';
  last_observation_at: string | Date | null;
  last_observation_kind: string | null;
  observation_fingerprint: string | null;
  last_trusted_evidence_at: string | Date | null;
  pending_since: string | Date | null;
  current_outage_id: string | null;
  current_external_alert_id: string | null;
  transition_sequence: number | string | null;
  event_payload: Record<string, unknown> | string | null;
};

/** Management removal pauses delivery; only recovery or a different outage supersedes it. */
export function conditionTriggerDisposition(
  event: NormalizedRmmAlertEvent,
  current: Pick<ConditionRow, 'state' | 'current_outage_id'> | undefined,
): 'deliver' | 'defer' | 'obsolete' {
  if (!current || current.current_outage_id !== event.raw.outageId) return 'obsolete';
  if (current.state === 'unmanaged') return 'defer';
  return current.state === 'firing' ? 'deliver' : 'obsolete';
}

/**
 * Persist observed conditions and atomically append alert transitions. Network
 * fetches belong in adapters and must finish before calling this function.
 * The tenant + integration + condition unique key serializes overlapping polls.
 */
export async function reconcileConditionObservations(args: {
  knex: Knex;
  tenantId: string;
  integrationId: string;
  observations: ConditionObservation[];
  successfulScopes: string[];
  failedScopes?: string[];
  scopeObservationTimes?: Record<string, string>;
  unmanagedScopes?: string[];
  unmanagedObservedAt?: string;
  graceMs: number;
  maxEvidenceGapMs: number;
  now?: Date;
}): Promise<ConditionTransitionResult> {
  const events: NormalizedRmmAlertEvent[] = [];
  const heldExternalAlertIds: string[] = [];
  let staleObservations = 0;
  const now = args.now ?? new Date();
  const db = tenantDb(args.knex, args.tenantId);

  for (const observation of args.observations) {
    if (!args.successfulScopes.includes(observation.scopeKey)) continue;
    const result = await args.knex.transaction(async (trx) => {
      const scoped = tenantDb(trx, args.tenantId);
      await scoped
        .table('rmm_condition_states')
        .insert({
          tenant: args.tenantId,
          integration_id: args.integrationId,
          scope_key: observation.scopeKey,
          subject_key: observation.subjectKey,
          condition_key: observation.conditionKey,
          state: 'healthy',
        })
        .onConflict(['tenant', 'integration_id', 'scope_key', 'subject_key', 'condition_key'])
        .ignore();

      const row = (await scoped
        .table('rmm_condition_states')
        .where({
          integration_id: args.integrationId,
          scope_key: observation.scopeKey,
          subject_key: observation.subjectKey,
          condition_key: observation.conditionKey,
        })
        .forUpdate()
        .first()) as ConditionRow;
      const observedAt = new Date(observation.observedAt);
      if (Number.isNaN(observedAt.getTime()))
        throw new Error('Condition observation observedAt must be a valid timestamp');
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            evidence: observation.evidence,
            event: observation.event,
          }),
        )
        .digest('hex');
      const lastAt = row.last_observation_at ? new Date(row.last_observation_at).getTime() : -Infinity;
      if (observedAt.getTime() < lastAt) return { stale: true, event: null, held: null };
      if (observedAt.getTime() === lastAt) {
        if (fingerprint === row.observation_fingerprint) {
          return {
            stale: false,
            event: null,
            held: ['firing', 'unmanaged'].includes(row.state) ? row.current_external_alert_id : null,
          };
        }
        // Conflicting payloads with the same provider ordering time have no
        // trustworthy order. Record uncertainty and retain the current state.
        await scoped
          .table('rmm_condition_states')
          .where({
            integration_id: args.integrationId,
            scope_key: observation.scopeKey,
            subject_key: observation.subjectKey,
            condition_key: observation.conditionKey,
          })
          .update({
            last_observation_kind: 'uncertain',
            observation_fingerprint: [fingerprint, row.observation_fingerprint ?? ''].sort()[1],
            updated_at: now.toISOString(),
          });
        return {
          stale: false,
          event: null,
          held: ['firing', 'unmanaged'].includes(row.state) ? row.current_external_alert_id : null,
        };
      }

      const base = observation.event;
      let state = row.state;
      let pendingSince = row.pending_since ? new Date(row.pending_since).toISOString() : null;
      let outageId = row.current_outage_id;
      let transition: NormalizedRmmAlertEvent | null = null;
      const metadata = {
        scopeKey: observation.scopeKey,
        subjectKey: observation.subjectKey,
        conditionKey: observation.conditionKey,
      };

      if (observation.evidence === 'failing') {
        const priorAt = row.last_trusted_evidence_at ? new Date(row.last_trusted_evidence_at).getTime() : -Infinity;
        const suppliedFailureTime = observation.failingSince ? new Date(observation.failingSince) : null;
        const latestFailure =
          suppliedFailureTime &&
          !Number.isNaN(suppliedFailureTime.getTime()) &&
          suppliedFailureTime.getTime() <= observedAt.getTime() &&
          (priorAt === -Infinity || suppliedFailureTime.getTime() >= priorAt)
            ? suppliedFailureTime
            : observedAt;
        const gap = observedAt.getTime() - priorAt;
        const evidenceGap = priorAt !== -Infinity && gap > args.maxEvidenceGapMs;
        if (state === 'unmanaged' && outageId && row.current_external_alert_id) state = 'firing';
        if (state === 'firing' && outageId && row.current_external_alert_id) {
          const suppressedAlert = await scoped.table('rmm_alerts').where({
            integration_id: args.integrationId,
            external_alert_id: row.current_external_alert_id,
            status: 'suppressed',
          }).first('alert_id');
          if (suppressedAlert) {
            const pendingRecheck = await scoped.table('rmm_condition_transitions').where({
              integration_id: args.integrationId, scope_key: observation.scopeKey,
              subject_key: observation.subjectKey, condition_key: observation.conditionKey,
              outage_id: outageId, transition_kind: 'recheck', status: 'pending',
            }).first('transition_id');
            if (!pendingRecheck) {
              transition = {
                ...base,
                kind: 'triggered',
                externalAlertId: row.current_external_alert_id,
                occurredAt: observedAt.toISOString(),
                raw: {
                  ...base.raw,
                  ...metadata,
                  outageId,
                  transition: 'firing',
                  __alga_condition_lifecycle: true,
                  __alga_condition_recheck: true,
                },
              };
            }
          }
        } else {
          if (state !== 'pending' || evidenceGap) {
            // An old provider timestamp cannot bridge a gap in observations.
            // Restart grace at this fresh observation when continuity was lost.
            pendingSince = evidenceGap ? observedAt.toISOString() : latestFailure.toISOString();
            state = 'pending';
          }
          const trustedStart = pendingSince ?? latestFailure.toISOString();
          if (observedAt.getTime() - new Date(trustedStart).getTime() >= args.graceMs) {
            outageId = randomUUID();
            state = 'firing';
            transition = {
              ...base,
              kind: 'triggered',
              externalAlertId: `condition:${outageId}`,
              occurredAt: trustedStart,
              raw: {
                ...base.raw,
                ...metadata,
                outageId,
                transition: 'firing',
                __alga_condition_lifecycle: true,
              },
            };
          }
        }
      } else if (observation.evidence === 'healthy') {
        if ((state === 'firing' || state === 'unmanaged') && outageId && row.current_external_alert_id) {
          transition = {
            ...base,
            kind: 'reset',
            externalAlertId: row.current_external_alert_id ?? `condition:${outageId}`,
            severity: 'none',
            occurredAt: observedAt.toISOString(),
            raw: {
              ...base.raw,
              ...metadata,
              outageId,
              transition: 'recovered',
              __alga_condition_lifecycle: true,
            },
          };
        }
        state = 'healthy';
        pendingSince = null;
        outageId = null;
      }

      const transitionSequence = Number(row.transition_sequence ?? 0) + (transition ? 1 : 0);
      await scoped
        .table('rmm_condition_states')
        .where({
          integration_id: args.integrationId,
          scope_key: observation.scopeKey,
          subject_key: observation.subjectKey,
          condition_key: observation.conditionKey,
        })
        .update({
          state,
          last_observation_at: observedAt.toISOString(),
          last_observation_kind: observation.evidence,
          observation_fingerprint: fingerprint,
          last_trusted_evidence_at:
            observation.evidence === 'uncertain' ? row.last_trusted_evidence_at : observedAt.toISOString(),
          pending_since: pendingSince,
          current_outage_id: outageId,
          transition_sequence: transitionSequence,
          current_external_alert_id:
            state === 'firing' || state === 'unmanaged'
              ? transition?.kind === 'triggered'
                ? transition.externalAlertId
                : (row.current_external_alert_id ?? `condition:${outageId}`)
              : null,
          event_payload: JSON.stringify(base),
          updated_at: now.toISOString(),
        });

      if (transition) {
        const transitionId = randomUUID();
        transition.raw = { ...transition.raw, transitionId };
        await scoped.table('rmm_condition_transitions').insert({
          tenant: args.tenantId,
          transition_id: transitionId,
          integration_id: args.integrationId,
          scope_key: observation.scopeKey,
          subject_key: observation.subjectKey,
          condition_key: observation.conditionKey,
          outage_id: transition.raw.outageId,
          transition_kind: transition.raw.__alga_condition_recheck === true ? 'recheck' : transition.kind,
          condition_sequence: transitionSequence,
          external_alert_id: transition.externalAlertId,
          event_payload: JSON.stringify(transition),
          status: 'pending',
        });
      }
      return {
        stale: false,
        event: transition,
        held:
          (state === 'firing' || state === 'unmanaged') && !transition
            ? (row.current_external_alert_id ?? (outageId ? `condition:${outageId}` : null))
            : null,
      };
    });

    if (result.stale) staleObservations += 1;
    if (result.held) heldExternalAlertIds.push(result.held);
  }

  for (const scopeKey of args.successfulScopes) {
    const scopeAt = new Date(args.scopeObservationTimes?.[scopeKey] ?? now.toISOString()).toISOString();
    const present = new Set(
      args.observations
        .filter((observation) => observation.scopeKey === scopeKey)
        .map((observation) => `${observation.subjectKey}\0${observation.conditionKey}`),
    );
    const rows = await db
      .table('rmm_condition_states')
      .where({ integration_id: args.integrationId, scope_key: scopeKey })
      .select('subject_key', 'condition_key');
    for (const row of rows) {
      if (present.has(`${row.subject_key}\0${row.condition_key}`)) continue;
      const update = db.table('rmm_condition_states').where({
        integration_id: args.integrationId,
        scope_key: scopeKey,
        subject_key: row.subject_key,
        condition_key: row.condition_key,
      });
      await update
        .where((q: any) => q.whereNull('last_observation_at').orWhere('last_observation_at', '<=', scopeAt))
        .update({
          last_observation_at: scopeAt,
          last_observation_kind: 'missing',
          updated_at: now.toISOString(),
        });
    }
  }
  for (const scopeKey of args.failedScopes ?? []) {
    const scopeAt = new Date(args.scopeObservationTimes?.[scopeKey] ?? now.toISOString()).toISOString();
    await db
      .table('rmm_condition_states')
      .where({ integration_id: args.integrationId, scope_key: scopeKey })
      .where((q: any) => q.whereNull('last_observation_at').orWhere('last_observation_at', '<=', scopeAt))
      .update({
        last_observation_at: scopeAt,
        last_observation_kind: 'scope_unavailable',
        updated_at: now.toISOString(),
      });
  }

  // Any active outage without an explicit transition stays held, including
  // missing subjects, failed scopes, and scopes removed from management.
  const eventIds = new Set(events.map((event) => event.externalAlertId));
  const active = await db
    .table('rmm_condition_states')
    .where({ integration_id: args.integrationId })
    .whereIn('state', ['firing', 'unmanaged'])
    .whereNotNull('current_external_alert_id')
    .select('current_external_alert_id');
  for (const row of active) {
    if (row.current_external_alert_id && !eventIds.has(row.current_external_alert_id))
      heldExternalAlertIds.push(row.current_external_alert_id);
  }

  if (args.unmanagedScopes?.length) {
    const managementAt = new Date(args.unmanagedObservedAt ?? now.toISOString());
    const conditions = await db
      .table('rmm_condition_states')
      .where({ integration_id: args.integrationId })
      .whereIn('scope_key', args.unmanagedScopes)
      .select('scope_key', 'subject_key', 'condition_key');
    for (const condition of conditions) {
      await args.knex.transaction(async (trx) => {
        const scoped = tenantDb(trx, args.tenantId);
        const current = (await scoped
          .table('rmm_condition_states')
          .where({
            integration_id: args.integrationId,
            scope_key: condition.scope_key,
            subject_key: condition.subject_key,
            condition_key: condition.condition_key,
          })
          .forUpdate()
          .first()) as ConditionRow;
        const lastAt = current.last_observation_at ? new Date(current.last_observation_at).getTime() : -Infinity;
        if (lastAt > managementAt.getTime() || !['pending', 'firing'].includes(current.state)) return;
        await scoped
          .table('rmm_condition_states')
          .where({
            integration_id: args.integrationId,
            scope_key: condition.scope_key,
            subject_key: condition.subject_key,
            condition_key: condition.condition_key,
          })
          .update({
            state: 'unmanaged',
            last_observation_at: managementAt.toISOString(),
            last_observation_kind: 'unmanaged',
            updated_at: now.toISOString(),
          });
      });
    }
    const unmanaged = await db
      .table('rmm_condition_states')
      .where({ integration_id: args.integrationId })
      .whereIn('scope_key', args.unmanagedScopes)
      .whereNotNull('current_external_alert_id')
      .select('current_external_alert_id');
    heldExternalAlertIds.push(
      ...unmanaged.map((row: { current_external_alert_id: string }) => row.current_external_alert_id),
    );
  }
  const pending = await db
    .table('rmm_condition_transitions')
    .where({ integration_id: args.integrationId, status: 'pending' })
    .select('transition_id', 'scope_key', 'subject_key', 'condition_key', 'outage_id', 'condition_sequence', 'event_payload')
    .orderBy('scope_key').orderBy('subject_key').orderBy('condition_key').orderBy('condition_sequence');
  const known = new Set(events.filter((event) => event.raw.__alga_condition_recheck !== true)
    .map((event) => `${event.kind}:${event.externalAlertId}`));
  const firstPendingByCondition = new Set<string>();
  for (const row of pending) {
    const identity = `${row.scope_key}\0${row.subject_key}\0${row.condition_key}`;
    if (firstPendingByCondition.has(identity)) continue;
    const event = (
      typeof row.event_payload === 'string' ? JSON.parse(row.event_payload) : row.event_payload
    ) as NormalizedRmmAlertEvent;
    if (event.kind === 'triggered') {
      const current = await db
        .table('rmm_condition_states')
        .where({
          integration_id: args.integrationId,
          scope_key: row.scope_key,
          subject_key: row.subject_key,
          condition_key: row.condition_key,
        })
        .first('state', 'current_outage_id');
      const disposition = conditionTriggerDisposition(event, current);
      if (disposition === 'defer') {
        // This head transition still belongs to the outage. Keep it pending
        // and block later delivery until management and failing evidence resume.
        firstPendingByCondition.add(identity);
        continue;
      }
      if (disposition === 'obsolete') {
        await db
          .table('rmm_condition_transitions')
          .where({ transition_id: row.transition_id })
          .update({ status: 'delivered', delivered_at: now.toISOString() });
        continue;
      }
    }
    firstPendingByCondition.add(identity);
    const key = `${event.kind}:${event.externalAlertId}`;
    if (!known.has(key)) {
      events.push(event);
      known.add(key);
    }
  }
  return {
    events,
    heldExternalAlertIds: [...new Set(heldExternalAlertIds)],
    staleObservations,
  };
}

/** Mark an outbox row after the normal alert pipeline has committed the event. */
export async function acknowledgeConditionTransition(
  ctx: RmmAlertProcessingContext,
  args: { tenantId: string; integrationId: string; transitionId: string },
): Promise<void> {
  const query = tenantDb(ctx.knex, args.tenantId)
    .table('rmm_condition_transitions')
    .where({ integration_id: args.integrationId, status: 'pending' });
  query.where({ transition_id: args.transitionId });
  await query.update({
    status: 'delivered',
    delivered_at: new Date().toISOString(),
  });
}
