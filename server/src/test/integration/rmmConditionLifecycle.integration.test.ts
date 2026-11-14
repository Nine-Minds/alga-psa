import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { acknowledgeConditionTransition, reconcileConditionObservations } from '@alga-psa/shared/rmm/alerts';
import {
  attachLegacyUnknownScopes,
  initializeUniFiConditionState,
} from '../../../../ee/server/src/lib/integrations/unifi/alerts/reconciliationFetcher';

let db: Knex;
let createTestDbConnection: typeof import('../../../test-utils/dbConfig').createTestDbConnection;
let wireLocalTestDbEnv: typeof import('../../../test-utils/dbConfig').wireLocalTestDbEnv;

describe('RMM condition lifecycle database persistence', () => {
  beforeAll(async () => {
    // This suite owns a disposable database instead of inheriting the legacy
    // shared test_database name used by older integration harnesses.
    process.env.TEST_DB_NAME ??= 'alga_unifi_lifecycle_test';
    ({ createTestDbConnection, wireLocalTestDbEnv } = await import('../../../test-utils/dbConfig'));
    wireLocalTestDbEnv();
    db = await createTestDbConnection({ runSeeds: false });
  }, 240_000);

  afterAll(async () => {
    await db?.destroy();
  }, 60_000);

  it('serializes overlapping polls, ignores stale evidence, preserves recovery, and isolates tenants', async () => {
    const tenant = randomUUID();
    const otherTenant = randomUUID();
    const integration = randomUUID();
    const otherIntegration = randomUUID();
    const sameTenantOtherIntegration = randomUUID();
    await db('tenants').insert([
      {
        tenant,
        client_name: 'Lifecycle test',
        email: `${tenant}@example.test`,
        product_code: 'psa',
      },
      {
        tenant: otherTenant,
        client_name: 'Other lifecycle test',
        email: `${otherTenant}@example.test`,
        product_code: 'psa',
      },
    ]);
    await db('rmm_integrations').insert([
      {
        tenant,
        integration_id: integration,
        provider: 'unifi',
        is_active: true,
        settings: {},
      },
      {
        tenant: otherTenant,
        integration_id: otherIntegration,
        provider: 'unifi',
        is_active: true,
        settings: {},
      },
      {
        tenant,
        integration_id: sameTenantOtherIntegration,
        provider: 'levelio',
        is_active: true,
        settings: {},
      },
    ]);

    const observation = (
      observedAt: string,
      evidence: 'failing' | 'healthy' | 'uncertain' = 'failing',
      subjectKey = 'device-a',
      scopeKey = 'controller:site-a',
      eventIntegrationId = integration,
    ) => ({
      scopeKey,
      subjectKey,
      conditionKey: 'device_offline',
      evidence,
      observedAt,
      event: {
        tenantId: tenant,
        integrationId: eventIntegrationId,
        provider: 'unifi' as const,
        externalDeviceId: subjectKey,
        conditionIdentity: 'device_offline',
        activityType: 'DEVICE_OFFLINE',
        alertClass: 'switch',
        sourceType: 'unifi_device_state',
        severity: evidence === 'healthy' ? ('none' as const) : ('major' as const),
        message: 'Core switch offline',
        externalOrganizationId: scopeKey,
        raw: { test: true },
      },
    });
    const firstAt = '2026-10-12T12:00:00.000Z';
    const first = await reconcileConditionObservations({
      knex: db,
      tenantId: tenant,
      integrationId: integration,
      observations: [observation(firstAt)],
      successfulScopes: ['controller:site-a'],
      graceMs: 60_000,
      maxEvidenceGapMs: 300_000,
      now: new Date(firstAt),
    });
    expect(first.events).toHaveLength(0);
    const afterGrace = '2026-10-12T12:01:01.000Z';
    const concurrent = await Promise.all(
      [1, 2].map(() =>
        reconcileConditionObservations({
          knex: db,
          tenantId: tenant,
          integrationId: integration,
          observations: [observation(afterGrace)],
          successfulScopes: ['controller:site-a'],
          graceMs: 60_000,
          maxEvidenceGapMs: 300_000,
          now: new Date(afterGrace),
        }),
      ),
    );
    const triggers = concurrent.flatMap((result) => result.events);
    expect(triggers.length).toBeGreaterThan(0);
    expect(new Set(triggers.map((event) => event.externalAlertId)).size).toBe(1);
    expect(triggers[0].kind).toBe('triggered');
    expect(
      await db('rmm_condition_transitions').where({
        tenant,
        integration_id: integration,
        transition_kind: 'triggered',
      }),
    ).toHaveLength(1);
    const active = await db('rmm_condition_states').where({ tenant, integration_id: integration }).first();
    const externalAlertId = active.current_external_alert_id;
    expect(active.state).toBe('firing');

    const staleUnmapping = await reconcileConditionObservations({
      knex: db,
      tenantId: tenant,
      integrationId: integration,
      observations: [],
      successfulScopes: [],
      unmanagedScopes: ['controller:site-a'],
      unmanagedObservedAt: firstAt,
      graceMs: 60_000,
      maxEvidenceGapMs: 300_000,
      now: new Date(afterGrace),
    });
    expect(staleUnmapping.heldExternalAlertIds).toContain(externalAlertId);
    expect((await db('rmm_condition_states').where({ tenant, integration_id: integration }).first()).state).toBe(
      'firing',
    );

    // Simulate process interruption after committing the transition but before
    // the RMM pipeline acknowledges it. A later poll replays the same ID.
    const replay = await reconcileConditionObservations({
      knex: db,
      tenantId: tenant,
      integrationId: integration,
      observations: [],
      successfulScopes: ['controller:site-a'],
      graceMs: 60_000,
      maxEvidenceGapMs: 300_000,
      now: new Date(afterGrace),
    });
    expect(replay.events.map((event) => event.externalAlertId)).toContain(externalAlertId);

    const stale = await reconcileConditionObservations({
      knex: db,
      tenantId: tenant,
      integrationId: integration,
      observations: [observation('2026-10-12T11:59:00.000Z', 'healthy')],
      successfulScopes: ['controller:site-a'],
      graceMs: 60_000,
      maxEvidenceGapMs: 300_000,
      now: new Date(afterGrace),
    });
    expect(stale.staleObservations).toBe(1);
    expect(stale.events.map((event) => event.externalAlertId)).toContain(externalAlertId); // pending outbox retries independently of this stale input
    expect(
      (await db('rmm_condition_states').where({ tenant, integration_id: integration }).first())
        .current_external_alert_id,
    ).toBe(externalAlertId);

    const recovery = await reconcileConditionObservations({
      knex: db,
      tenantId: tenant,
      integrationId: integration,
      observations: [observation('2026-10-12T12:02:00.000Z', 'healthy')],
      successfulScopes: ['controller:site-a'],
      graceMs: 60_000,
      maxEvidenceGapMs: 300_000,
      now: new Date('2026-10-12T12:02:00.000Z'),
    });
    expect(recovery.staleObservations).toBe(0);
    expect(await db('rmm_condition_states').where({ tenant, integration_id: integration }).first()).toMatchObject({
      state: 'healthy',
      current_outage_id: null,
    });
    expect(recovery.events).toHaveLength(1); // stale trigger is discarded; only explicit recovery remains
    expect(recovery.events[0]).toMatchObject({
      kind: 'reset',
      externalAlertId,
    });
    expect(
      await db('rmm_condition_transitions').where({
        tenant,
        integration_id: integration,
      }),
    ).toHaveLength(2);
    await acknowledgeConditionTransition(
      { knex: db },
      {
        tenantId: tenant,
        integrationId: integration,
        transitionId: String(triggers[0].raw.transitionId),
      },
    );
    expect(
      await db('rmm_condition_transitions')
        .where({ tenant, integration_id: integration, status: 'pending' })
        .select('transition_kind'),
    ).toEqual([{ transition_kind: 'reset' }]);
    await acknowledgeConditionTransition(
      { knex: db },
      {
        tenantId: tenant,
        integrationId: integration,
        transitionId: String(recovery.events[0].raw.transitionId),
      },
    );
    expect(
      await db('rmm_condition_transitions').where({
        tenant,
        integration_id: integration,
        status: 'pending',
      }),
    ).toHaveLength(0);

    const isolated = await reconcileConditionObservations({
      knex: db,
      tenantId: otherTenant,
      integrationId: otherIntegration,
      observations: [observation('2026-10-12T12:02:01.000Z')],
      successfulScopes: ['controller:site-a'],
      graceMs: 60_000,
      maxEvidenceGapMs: 300_000,
      now: new Date('2026-10-12T12:02:01.000Z'),
    });
    expect(isolated.events).toHaveLength(0);
    expect(
      await db('rmm_condition_states').where({
        tenant: otherTenant,
        integration_id: otherIntegration,
      }),
    ).toHaveLength(1);
    expect(
      await db('rmm_condition_states').where({
        tenant,
        integration_id: integration,
      }),
    ).toHaveLength(1);

    const integrationIsolated = await reconcileConditionObservations({
      knex: db,
      tenantId: tenant,
      integrationId: sameTenantOtherIntegration,
      observations: [
        observation('2026-10-12T12:02:01.000Z', 'failing', 'device-a', 'controller:site-a', sameTenantOtherIntegration),
      ],
      successfulScopes: ['controller:site-a'],
      graceMs: 60_000,
      maxEvidenceGapMs: 300_000,
      now: new Date('2026-10-12T12:02:01.000Z'),
    });
    expect(integrationIsolated.events).toHaveLength(0);
    expect(
      await db('rmm_condition_states').where({
        tenant,
        integration_id: sameTenantOtherIntegration,
      }),
    ).toHaveLength(1);
    const scopeIsolated = await reconcileConditionObservations({
      knex: db,
      tenantId: tenant,
      integrationId: integration,
      observations: [observation('2026-10-12T12:02:02.000Z', 'failing', 'device-a', 'controller:site-b')],
      successfulScopes: ['controller:site-b'],
      graceMs: 60_000,
      maxEvidenceGapMs: 300_000,
      now: new Date('2026-10-12T12:02:02.000Z'),
    });
    expect(scopeIsolated.events).toHaveLength(0);
    expect(
      await db('rmm_condition_states').where({
        tenant,
        integration_id: integration,
        subject_key: 'device-a',
      }),
    ).toHaveLength(2);

    const beforeGap = await reconcileConditionObservations({
      knex: db,
      tenantId: tenant,
      integrationId: integration,
      observations: [observation('2026-10-12T12:00:00.000Z', 'failing', 'gap-device')],
      successfulScopes: ['controller:site-a'],
      graceMs: 60_000,
      maxEvidenceGapMs: 300_000,
      now: new Date('2026-10-12T12:00:00.000Z'),
    });
    expect(beforeGap.events).toHaveLength(0);
    const afterGap = await reconcileConditionObservations({
      knex: db,
      tenantId: tenant,
      integrationId: integration,
      observations: [
        {
          ...observation('2026-10-12T12:12:00.000Z', 'failing', 'gap-device'),
          failingSince: '2026-10-12T12:00:00.000Z',
        },
      ],
      successfulScopes: ['controller:site-a'],
      graceMs: 60_000,
      maxEvidenceGapMs: 300_000,
      now: new Date('2026-10-12T12:12:00.000Z'),
    });
    expect(afterGap.events).toHaveLength(0);
    expect(
      (
        await db('rmm_condition_states')
          .where({
            tenant,
            integration_id: integration,
            subject_key: 'gap-device',
          })
          .first()
      ).pending_since,
    ).toEqual(new Date('2026-10-12T12:12:00.000Z'));
    const matureAfterFreshEvidence = await reconcileConditionObservations({
      knex: db,
      tenantId: tenant,
      integrationId: integration,
      observations: [
        {
          ...observation('2026-10-12T12:13:01.000Z', 'failing', 'gap-device'),
          failingSince: '2026-10-12T12:00:00.000Z',
        },
      ],
      successfulScopes: ['controller:site-a'],
      graceMs: 60_000,
      maxEvidenceGapMs: 300_000,
      now: new Date('2026-10-12T12:13:01.000Z'),
    });
    expect(matureAfterFreshEvidence.events).toHaveLength(1);
    expect(matureAfterFreshEvidence.events[0]).toMatchObject({
      kind: 'triggered',
      occurredAt: '2026-10-12T12:12:00.000Z',
    });
  });

  it('does not resolve on uncertain, missing, failed-scope, or unmanaged evidence', async () => {
    const tenant = randomUUID();
    const integration = randomUUID();
    await db('tenants').insert({
      tenant,
      client_name: 'Lifecycle guard',
      email: `${tenant}@example.test`,
      product_code: 'psa',
    });
    await db('rmm_integrations').insert({
      tenant,
      integration_id: integration,
      provider: 'unifi',
      is_active: true,
      settings: {},
    });
    const base = {
      scopeKey: 'c:s',
      subjectKey: 'gw-1',
      conditionKey: 'device_offline',
      evidence: 'failing' as const,
      observedAt: '2026-10-12T12:00:00.000Z',
      event: {
        tenantId: tenant,
        integrationId: integration,
        provider: 'unifi' as const,
        externalDeviceId: 'gw-1',
        severity: 'critical' as const,
        raw: {},
      },
    };
    await reconcileConditionObservations({
      knex: db,
      tenantId: tenant,
      integrationId: integration,
      observations: [base],
      successfulScopes: ['c:s'],
      graceMs: 60_000,
      maxEvidenceGapMs: 300_000,
    });
    const fired = await reconcileConditionObservations({
      knex: db,
      tenantId: tenant,
      integrationId: integration,
      observations: [{ ...base, observedAt: '2026-10-12T12:01:01.000Z' }],
      successfulScopes: ['c:s'],
      graceMs: 60_000,
      maxEvidenceGapMs: 300_000,
    });
    const outageId = fired.events[0].externalAlertId;
    await acknowledgeConditionTransition(
      { knex: db },
      {
        tenantId: tenant,
        integrationId: integration,
        transitionId: String(fired.events[0].raw.transitionId),
      },
    );
    const uncertain = await reconcileConditionObservations({
      knex: db,
      tenantId: tenant,
      integrationId: integration,
      observations: [
        {
          ...base,
          evidence: 'uncertain',
          observedAt: '2026-10-12T12:01:02.000Z',
        },
      ],
      successfulScopes: ['c:s'],
      graceMs: 0,
      maxEvidenceGapMs: 300_000,
    });
    expect(uncertain.events).toHaveLength(0);
    expect(uncertain.heldExternalAlertIds).toContain(outageId);
    let stored = await db('rmm_condition_states').where({ tenant, integration_id: integration }).first();
    expect(stored.last_observation_kind).toBe('uncertain');
    expect(stored.last_trusted_evidence_at).toEqual(new Date('2026-10-12T12:01:01.000Z'));
    const missing = await reconcileConditionObservations({
      knex: db,
      tenantId: tenant,
      integrationId: integration,
      observations: [],
      successfulScopes: ['c:s'],
      graceMs: 0,
      maxEvidenceGapMs: 300_000,
    });
    expect(missing.heldExternalAlertIds).toContain(outageId);
    stored = await db('rmm_condition_states')
      .where({
        tenant,
        integration_id: integration,
        scope_key: 'c:s',
        subject_key: 'gw-1',
      })
      .first();
    expect(stored.last_observation_kind).toBe('missing');
    const failedScope = await reconcileConditionObservations({
      knex: db,
      tenantId: tenant,
      integrationId: integration,
      observations: [],
      successfulScopes: [],
      failedScopes: ['c:s'],
      graceMs: 0,
      maxEvidenceGapMs: 300_000,
    });
    expect(failedScope.heldExternalAlertIds).toContain(outageId);
    stored = await db('rmm_condition_states').where({ tenant, integration_id: integration }).first();
    expect(stored.last_observation_kind).toBe('scope_unavailable');

    const branchStart = new Date(Date.now() + 1_000);
    const branchObservation = (evidence: 'failing' | 'healthy', observedAt: Date) => ({
      ...base,
      scopeKey: 'c:other',
      subjectKey: 'gw-2',
      evidence,
      observedAt: observedAt.toISOString(),
      event: {
        ...base.event,
        externalDeviceId: 'gw-2',
        externalOrganizationId: 'c:other',
      },
    });
    const branchPending = await reconcileConditionObservations({
      knex: db,
      tenantId: tenant,
      integrationId: integration,
      observations: [branchObservation('failing', branchStart)],
      successfulScopes: ['c:other'],
      failedScopes: ['c:s'],
      graceMs: 60_000,
      maxEvidenceGapMs: 300_000,
      now: branchStart,
    });
    expect(branchPending.events).toHaveLength(0);
    const branchTriggerAt = new Date(branchStart.getTime() + 61_000);
    const branchTrigger = await reconcileConditionObservations({
      knex: db,
      tenantId: tenant,
      integrationId: integration,
      observations: [branchObservation('failing', branchTriggerAt)],
      successfulScopes: ['c:other'],
      failedScopes: ['c:s'],
      graceMs: 60_000,
      maxEvidenceGapMs: 300_000,
      now: branchTriggerAt,
    });
    expect(branchTrigger.events).toMatchObject([{ kind: 'triggered', externalDeviceId: 'gw-2' }]);
    expect(branchTrigger.heldExternalAlertIds).toContain(outageId);
    await acknowledgeConditionTransition(
      { knex: db },
      {
        tenantId: tenant,
        integrationId: integration,
        transitionId: String(branchTrigger.events[0].raw.transitionId),
      },
    );
    const branchRecoveryAt = new Date(branchStart.getTime() + 62_000);
    const branchRecovery = await reconcileConditionObservations({
      knex: db,
      tenantId: tenant,
      integrationId: integration,
      observations: [branchObservation('healthy', branchRecoveryAt)],
      successfulScopes: ['c:other'],
      failedScopes: ['c:s'],
      graceMs: 60_000,
      maxEvidenceGapMs: 300_000,
      now: branchRecoveryAt,
    });
    expect(branchRecovery.events).toMatchObject([{ kind: 'reset', externalDeviceId: 'gw-2' }]);
    expect(branchRecovery.heldExternalAlertIds).toContain(outageId);
    await acknowledgeConditionTransition(
      { knex: db },
      {
        tenantId: tenant,
        integrationId: integration,
        transitionId: String(branchRecovery.events[0].raw.transitionId),
      },
    );

    const pendingAnchor = '2026-10-12T12:03:03.000Z';
    await reconcileConditionObservations({
      knex: db,
      tenantId: tenant,
      integrationId: integration,
      observations: [
        {
          ...base,
          subjectKey: 'gw-pending',
          observedAt: pendingAnchor,
          event: { ...base.event, externalDeviceId: 'gw-pending' },
        },
      ],
      successfulScopes: ['c:s'],
      graceMs: 60_000,
      maxEvidenceGapMs: 300_000,
      now: new Date(pendingAnchor),
    });
    const unmanaged = await reconcileConditionObservations({
      knex: db,
      tenantId: tenant,
      integrationId: integration,
      observations: [],
      successfulScopes: [],
      unmanagedScopes: ['c:s'],
      unmanagedObservedAt: new Date(branchStart.getTime() + 100_000).toISOString(),
      graceMs: 0,
      maxEvidenceGapMs: 300_000,
    });
    expect(unmanaged.heldExternalAlertIds).toContain(outageId);
    stored = await db('rmm_condition_states')
      .where({
        tenant,
        integration_id: integration,
        scope_key: 'c:s',
        subject_key: 'gw-1',
      })
      .first();
    expect(stored.state).toBe('unmanaged');
    expect(stored.last_observation_kind).toBe('unmanaged');
    const unmanagedPending = await db('rmm_condition_states')
      .where({
        tenant,
        integration_id: integration,
        scope_key: 'c:s',
        subject_key: 'gw-pending',
      })
      .first();
    expect(unmanagedPending).toMatchObject({
      state: 'unmanaged',
      pending_since: new Date(pendingAnchor),
    });
    const reattachedAt = new Date(branchStart.getTime() + 101_000).toISOString();
    const reattachedRecovery = await reconcileConditionObservations({
      knex: db,
      tenantId: tenant,
      integrationId: integration,
      observations: [{ ...base, evidence: 'healthy', observedAt: reattachedAt }],
      successfulScopes: ['c:s'],
      graceMs: 0,
      maxEvidenceGapMs: 300_000,
      now: new Date(reattachedAt),
    });
    expect(reattachedRecovery.events).toMatchObject([{ kind: 'reset', externalAlertId: outageId }]);
  });

  it('migrates pending timestamps and active external IDs idempotently while retaining resolved alert history', async () => {
    const tenant = randomUUID();
    const integration = randomUUID();
    await db('tenants').insert({
      tenant,
      client_name: 'Lifecycle migration',
      email: `${tenant}@example.test`,
      product_code: 'psa',
    });
    await db('rmm_integrations').insert({
      tenant,
      integration_id: integration,
      provider: 'unifi',
      is_active: true,
      settings: {
        keepThisSetting: 'preserved',
        unifiOfflineObservations: { pendingDevice: '2026-10-12T11:55:00.000Z' },
      },
    });
    await db('tenant_external_entity_mappings').insert({
      tenant,
      integration_type: 'unifi',
      alga_entity_type: 'asset',
      alga_entity_id: 'legacy-active-asset',
      external_entity_id: 'activeDevice',
      external_realm_id: null,
    });
    await db('rmm_alerts').insert([
      {
        tenant,
        integration_id: integration,
        external_alert_id: 'legacy-active-1',
        external_device_id: 'activeDevice',
        severity: 'major',
        status: 'active',
        activity_type: 'DEVICE_OFFLINE',
        ticket_id: randomUUID(),
        triggered_at: '2026-10-12T11:40:00.000Z',
        metadata: {},
      },
      {
        tenant,
        integration_id: integration,
        external_alert_id: 'legacy-resolved-1',
        external_device_id: 'resolvedDevice',
        severity: 'major',
        status: 'resolved',
        activity_type: 'DEVICE_OFFLINE',
        triggered_at: '2026-10-11T11:40:00.000Z',
        resolved_at: '2026-10-11T12:00:00.000Z',
        metadata: { scopeKey: 'controller:site-a' },
      },
    ]);

    await initializeUniFiConditionState(db, tenant, integration);
    await initializeUniFiConditionState(db, tenant, integration);
    const pending = await db('rmm_condition_states')
      .where({
        tenant,
        integration_id: integration,
        subject_key: 'pendingDevice',
      })
      .first();
    let active = await db('rmm_condition_states')
      .where({
        tenant,
        integration_id: integration,
        subject_key: 'activeDevice',
      })
      .first();
    const settings = await db('rmm_integrations').where({ tenant, integration_id: integration }).first('settings');
    expect(pending).toMatchObject({
      state: 'pending',
      pending_since: new Date('2026-10-12T11:55:00.000Z'),
    });
    expect(active).toMatchObject({
      state: 'firing',
      scope_key: 'legacy-unknown:activeDevice',
      current_external_alert_id: 'legacy-active-1',
    });
    await attachLegacyUnknownScopes(db, tenant, integration, [
      {
        scopeKey: 'controller:site-a',
        subjectKey: 'activeDevice',
        conditionKey: 'device_offline',
        evidence: 'failing',
        observedAt: '2026-10-12T12:00:01.000Z',
        event: {
          tenantId: tenant,
          integrationId: integration,
          provider: 'unifi',
          externalDeviceId: 'activeDevice',
          severity: 'major',
        },
      },
    ]);
    active = await db('rmm_condition_states')
      .where({
        tenant,
        integration_id: integration,
        subject_key: 'activeDevice',
      })
      .first();
    expect(active).toMatchObject({
      state: 'firing',
      scope_key: 'controller:site-a',
      current_external_alert_id: 'legacy-active-1',
    });
    expect(settings.settings).toMatchObject({ keepThisSetting: 'preserved' });
    expect(settings.settings.unifiOfflineObservations).toBeUndefined();
    expect(
      await db('rmm_alerts').where({
        tenant,
        integration_id: integration,
        external_alert_id: 'legacy-resolved-1',
      }),
    ).toHaveLength(1);
    expect(
      await db('rmm_condition_states').where({
        tenant,
        integration_id: integration,
        subject_key: 'activeDevice',
      }),
    ).toHaveLength(1);
  });
});
